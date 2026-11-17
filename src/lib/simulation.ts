// Drone simulation engine
import type { Drone, Node } from '@/types/database';
import { updateDronePosition, createTransaction, updateNodeLoad } from '@/db/api';
import { planRoute, selectChargingTarget, type PlannedRoute, type Waypoint } from '@/lib/pathPlanner';

const SOL_PER_PERCENT = 0.001;

type ChargeSession = {
  startBattery: number;
  nodeId: string;
  reserved: boolean;
};

const routeCache = new Map<string, PlannedRoute>();
const chargeSessions = new Map<string, ChargeSession>();
/** Node slot held by a drone that is en_route or charging. */
const reservedNodeByDrone = new Map<string, string>();

export const calculateDistance = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

export const moveDrone = (
  drone: Drone,
  targetLat: number,
  targetLng: number,
  speed: number = 0.001
): { lat: number; lng: number; arrived: boolean } => {
  const distance = calculateDistance(drone.lat, drone.lng, targetLat, targetLng);

  if (distance < 0.1) {
    return { lat: targetLat, lng: targetLng, arrived: true };
  }

  const latDiff = targetLat - drone.lat;
  const lngDiff = targetLng - drone.lng;
  const angle = Math.atan2(lngDiff, latDiff);

  return {
    lat: drone.lat + Math.cos(angle) * speed,
    lng: drone.lng + Math.sin(angle) * speed,
    arrived: false,
  };
};

export const calculateBatteryDrain = (distance: number): number => {
  return distance * 0.5;
};

const generateMissionTarget = (drone: Drone): Waypoint => ({
  lat: drone.lat + (Math.random() - 0.5) * 0.1,
  lng: drone.lng + (Math.random() - 0.5) * 0.1,
});

const matchNodeNear = (point: Waypoint, nodes: Node[], toleranceKm = 0.15): Node | null => {
  let best: Node | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const node of nodes) {
    const distance = calculateDistance(point.lat, point.lng, node.lat, node.lng);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = node;
    }
  }
  return best && bestDistance <= toleranceKm ? best : null;
};

const cloneNodes = (nodes: Node[]): Node[] => nodes.map((node) => ({ ...node }));

const applyNodeLoad = async (nodes: Node[], nodeId: string, nextLoad: number): Promise<void> => {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (node) {
    node.current_load = Math.max(0, nextLoad);
  }
  await updateNodeLoad(nodeId, Math.max(0, nextLoad));
};

const reserveNode = async (nodes: Node[], nodeId: string): Promise<void> => {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) return;
  await applyNodeLoad(nodes, nodeId, node.current_load + 1);
};

const releaseNode = async (nodes: Node[], nodeId: string): Promise<void> => {
  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node) return;
  await applyNodeLoad(nodes, nodeId, Math.max(0, node.current_load - 1));
};

const hydrateRouteFromDrone = (drone: Drone, nodes: Node[]): PlannedRoute | null => {
  const waypoints = drone.route_waypoints;
  const intent = drone.route_intent;
  if (!waypoints?.length || (intent !== 'mission' && intent !== 'charging')) {
    return null;
  }

  const last = waypoints[waypoints.length - 1];
  const matchedNode =
    intent === 'charging'
      ? drone.current_node_id
        ? nodes.find((node) => node.id === drone.current_node_id) ?? null
        : matchNodeNear(last, nodes)
      : null;

  const plannedRoute: PlannedRoute = {
    waypoints: waypoints.map((point) => ({ lat: point.lat, lng: point.lng })),
    intent,
    targetNodeId: matchedNode?.id ?? null,
  };
  routeCache.set(drone.id, plannedRoute);
  return plannedRoute;
};

const getRouteForDrone = (drone: Drone, nodes: Node[]): PlannedRoute | null => {
  const cached = routeCache.get(drone.id);
  if (cached?.waypoints.length) {
    return cached;
  }
  return hydrateRouteFromDrone(drone, nodes);
};

const ensureChargeSession = (drone: Drone): void => {
  if (drone.status !== 'charging' || !drone.current_node_id) return;
  if (!chargeSessions.has(drone.id)) {
    chargeSessions.set(drone.id, {
      startBattery: drone.battery,
      nodeId: drone.current_node_id,
      reserved: true,
    });
  }
  if (!reservedNodeByDrone.has(drone.id)) {
    // Seeded / refreshed charging drones already occupy a slot in node.current_load.
    reservedNodeByDrone.set(drone.id, drone.current_node_id);
  }
};

const ensureReservation = async (
  droneId: string,
  nodeId: string,
  nodes: Node[]
): Promise<boolean> => {
  if (reservedNodeByDrone.get(droneId) === nodeId) {
    return true;
  }

  const previous = reservedNodeByDrone.get(droneId);
  if (previous && previous !== nodeId) {
    await releaseNode(nodes, previous);
    reservedNodeByDrone.delete(droneId);
  }

  const node = nodes.find((entry) => entry.id === nodeId);
  if (!node || node.current_load >= node.capacity) {
    return false;
  }

  await reserveNode(nodes, nodeId);
  reservedNodeByDrone.set(droneId, nodeId);
  return true;
};

const clearReservation = async (droneId: string, nodes: Node[]): Promise<void> => {
  const nodeId = reservedNodeByDrone.get(droneId);
  if (!nodeId) return;
  await releaseNode(nodes, nodeId);
  reservedNodeByDrone.delete(droneId);
};

const resolveChargingRoute = async (
  drone: Drone,
  nodes: Node[],
  drones: Drone[]
): Promise<PlannedRoute | null> => {
  const existing = getRouteForDrone(drone, nodes);
  if (existing?.intent === 'charging' && existing.waypoints.length > 0 && existing.targetNodeId) {
    const kept = await ensureReservation(drone.id, existing.targetNodeId, nodes);
    if (kept) {
      return existing;
    }
    routeCache.delete(drone.id);
  }

  const targetNode = selectChargingTarget(drone, nodes, drones);
  if (!targetNode) return null;

  const reserved = await ensureReservation(drone.id, targetNode.id, nodes);
  if (!reserved) return null;

  const waypoints = await planRoute({
    start: { lat: drone.lat, lng: drone.lng },
    target: { lat: targetNode.lat, lng: targetNode.lng },
    drone,
    nodes,
    drones,
  });

  const plannedRoute: PlannedRoute = {
    waypoints,
    intent: 'charging',
    targetNodeId: targetNode.id,
  };

  routeCache.set(drone.id, plannedRoute);
  return plannedRoute;
};

const resolveMissionRoute = async (
  drone: Drone,
  nodes: Node[],
  drones: Drone[]
): Promise<PlannedRoute> => {
  const existing = getRouteForDrone(drone, nodes);
  if (existing?.intent === 'mission' && existing.waypoints.length > 0) {
    return existing;
  }

  const target: Waypoint =
    drone.destination_lat !== null && drone.destination_lng !== null
      ? { lat: drone.destination_lat, lng: drone.destination_lng }
      : generateMissionTarget(drone);

  const waypoints = await planRoute({
    start: { lat: drone.lat, lng: drone.lng },
    target,
    drone,
    nodes,
    drones,
  });

  const plannedRoute: PlannedRoute = {
    waypoints,
    intent: 'mission',
  };

  routeCache.set(drone.id, plannedRoute);
  return plannedRoute;
};

const advanceAlongRoute = async (
  drone: Drone,
  plannedRoute: PlannedRoute,
  nodes: Node[],
  movingStatus: 'flying' | 'en_route'
): Promise<void> => {
  const next = plannedRoute.waypoints[0];
  if (!next) {
    routeCache.delete(drone.id);
    await updateDronePosition(drone.id, drone.lat, drone.lng, drone.battery, 'idle', {
      waypoints: [],
      intent: null,
      current_node_id: null,
      destination_lat: null,
      destination_lng: null,
    });
    return;
  }

  const { lat, lng, arrived } = moveDrone(drone, next.lat, next.lng);
  const distanceTraveled = calculateDistance(drone.lat, drone.lng, lat, lng);
  const batteryDrain = calculateBatteryDrain(distanceTraveled);
  const newBattery = Math.max(0, drone.battery - batteryDrain);

  if (arrived) {
    plannedRoute.waypoints.shift();
  }

  if (plannedRoute.waypoints.length === 0) {
    if (plannedRoute.intent === 'charging' && plannedRoute.targetNodeId) {
      chargeSessions.set(drone.id, {
        startBattery: newBattery,
        nodeId: plannedRoute.targetNodeId,
        reserved: true,
      });
      await updateDronePosition(drone.id, lat, lng, newBattery, 'charging', {
        waypoints: [],
        intent: null,
        current_node_id: plannedRoute.targetNodeId,
        destination_lat: null,
        destination_lng: null,
      });
    } else {
      await updateDronePosition(drone.id, lat, lng, newBattery, 'idle', {
        waypoints: [],
        intent: null,
        current_node_id: null,
        destination_lat: null,
        destination_lng: null,
      });
    }
    routeCache.delete(drone.id);
    return;
  }

  await updateDronePosition(drone.id, lat, lng, newBattery, movingStatus, {
    waypoints: plannedRoute.waypoints,
    intent: plannedRoute.intent,
    current_node_id: null,
    destination_lat: plannedRoute.waypoints[plannedRoute.waypoints.length - 1]?.lat ?? null,
    destination_lng: plannedRoute.waypoints[plannedRoute.waypoints.length - 1]?.lng ?? null,
  });
  routeCache.set(drone.id, plannedRoute);
};

export const simulateDrone = async (
  drone: Drone,
  nodes: Node[],
  drones: Drone[]
): Promise<void> => {
  try {
    ensureChargeSession(drone);

    if (drone.battery < 25 && drone.status !== 'charging') {
      const chargingRoute = await resolveChargingRoute(drone, nodes, drones);
      if (chargingRoute) {
        await advanceAlongRoute(drone, chargingRoute, nodes, 'en_route');
        return;
      }
    }

    if (drone.status === 'charging') {
      const newBattery = Math.min(100, drone.battery + 2);
      const session = chargeSessions.get(drone.id);
      const nodeId = session?.nodeId ?? drone.current_node_id;

      if (newBattery >= 95) {
        if (drone.company_id && nodeId) {
          const startBattery = session?.startBattery ?? drone.battery;
          const chargedPercent = Math.max(0, newBattery - startBattery);
          const chargingAmount = chargedPercent * SOL_PER_PERCENT;
          if (chargingAmount > 0) {
            await createTransaction(drone.id, nodeId, drone.company_id, chargingAmount);
          }
        }

        await clearReservation(drone.id, nodes);
        chargeSessions.delete(drone.id);
        await updateDronePosition(drone.id, drone.lat, drone.lng, newBattery, 'idle', {
          waypoints: [],
          intent: null,
          current_node_id: null,
          destination_lat: null,
          destination_lng: null,
        });
      } else {
        if (nodeId) {
          await ensureReservation(drone.id, nodeId, nodes);
        }
        await updateDronePosition(drone.id, drone.lat, drone.lng, newBattery, 'charging', {
          waypoints: [],
          intent: null,
          current_node_id: nodeId,
        });
      }
      return;
    }

    if (drone.status === 'idle' && Math.random() > 0.7) {
      const missionRoute = await resolveMissionRoute(drone, nodes, drones);
      await advanceAlongRoute(drone, missionRoute, nodes, 'flying');
      return;
    }

    if (drone.status === 'en_route') {
      const chargingRoute = await resolveChargingRoute(drone, nodes, drones);
      if (chargingRoute) {
        await advanceAlongRoute(drone, chargingRoute, nodes, 'en_route');
        return;
      }
    }

    if (drone.status === 'flying') {
      const missionRoute = await resolveMissionRoute(drone, nodes, drones);
      await advanceAlongRoute(drone, missionRoute, nodes, 'flying');
    }
  } catch (error) {
    console.error(`Error simulating drone ${drone.id}:`, error);
  }
};

export const runSimulation = async (drones: Drone[], nodes: Node[]): Promise<void> => {
  const workingNodes = cloneNodes(nodes);
  for (const drone of drones) {
    await simulateDrone(drone, workingNodes, drones);
  }
};
