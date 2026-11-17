import React, { useEffect, useState, useRef } from 'react';
import MainLayout from '@/components/layouts/MainLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { getDrones, getNodes, subscribeToDrones, subscribeToNodes } from '@/db/api';
import { runSimulation } from '@/lib/simulation';
import type { DroneWithCompany, Node } from '@/types/database';
import { Zap, MapPin, Activity } from 'lucide-react';
import { createDroneIcon, createNodeIcon } from '@/lib/leafletIcons';
import { getRouteColor } from '@/lib/routeColors';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_URL,
} from '@/lib/mapTiles';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

const FleetMapPage: React.FC = () => {
  const [drones, setDrones] = useState<DroneWithCompany[]>([]);
  const [nodes, setNodes] = useState<Node[]>([]);
  const [loading, setLoading] = useState(true);
  const [apiAvailable, setApiAvailable] = useState(true);
  const simulationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any>(null);
  const droneMarkersRef = useRef<Map<string, any>>(new Map());
  const droneRoutesRef = useRef<Map<string, any>>(new Map());
  const nodeMarkersRef = useRef<Map<string, any>>(new Map());
  const droneAnimationRef = useRef<Map<string, number>>(new Map());
  const lastDronePositionRef = useRef<Map<string, [number, number]>>(new Map());
  const hasFitBoundsRef = useRef(false);
  const [leafletReady, setLeafletReady] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [showRoutes, setShowRoutes] = useState(true);
  const { profile } = useAuth();

  const ownCompanyId = profile?.role === 'admin' ? null : profile?.company_id ?? null;
  const displayDrones = apiAvailable ? drones : [];
  const displayNodes = apiAvailable ? nodes : [];
  const ownCompanyDrones =
    ownCompanyId === null
      ? displayDrones
      : displayDrones.filter((drone) => drone.company_id === ownCompanyId);
  const droneStatusList =
    profile?.role === 'admin'
      ? displayDrones
      : ownCompanyId
        ? ownCompanyDrones
        : [];

  const getDroneColor = (drone: DroneWithCompany) => {
    if (profile?.role === 'admin') return '#06a9e0';
    return drone.company_id && drone.company_id === ownCompanyId ? '#06a9e0' : '#111827';
  };

  const isHighlightedDrone = (drone: DroneWithCompany) =>
    profile?.role === 'admin' || (drone.company_id && drone.company_id === ownCompanyId);

  useEffect(() => {
    loadData();

    const dronesChannel = subscribeToDrones((payload) => {
      setApiAvailable(true);
      setDrones(payload.data);
    });

    const nodesChannel = subscribeToNodes((payload) => {
      setApiAvailable(true);
      setNodes(payload.data);
    });

    simulationInterval.current = setInterval(() => {
      runSimulationCycle();
    }, 2000);

    return () => {
      dronesChannel.unsubscribe();
      nodesChannel.unsubscribe();
      if (simulationInterval.current) {
        clearInterval(simulationInterval.current);
      }
    };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    if (!L) {
      setLeafletReady(false);
      return;
    }
    setLeafletReady(true);
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: DEFAULT_MAP_CENTER,
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
      attributionControl: false,
    });
    leafletMapRef.current = map;
    setMapReady(true);

    L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map || !mapReady) return;

    const nextIds = new Set(displayNodes.map((node) => node.id));
    nodeMarkersRef.current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.remove();
        nodeMarkersRef.current.delete(id);
      }
    });

    displayNodes.forEach((node) => {
      const existing = nodeMarkersRef.current.get(node.id);
      if (existing) {
        existing.setLatLng([node.lat, node.lng]);
      } else {
        const marker = L.marker([node.lat, node.lng], {
          icon: createNodeIcon(L),
        })
          .bindPopup(node.name)
          .addTo(map);
        nodeMarkersRef.current.set(node.id, marker);
      }
    });
  }, [displayNodes, mapReady]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map || !mapReady) return;

    const nextIds = new Set(displayDrones.map((drone) => drone.id));
    droneMarkersRef.current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        const anim = droneAnimationRef.current.get(id);
        if (anim) {
          cancelAnimationFrame(anim);
          droneAnimationRef.current.delete(id);
        }
        marker.remove();
        droneMarkersRef.current.delete(id);
        lastDronePositionRef.current.delete(id);
      }
    });

    displayDrones.forEach((drone) => {
      const existing = droneMarkersRef.current.get(drone.id);
      const nextPosition: [number, number] = [drone.lat, drone.lng];
      const iconColor = getDroneColor(drone);
      const current = existing ? existing.getLatLng() : { lat: drone.lat, lng: drone.lng };
      if (existing) {
        existing.setIcon(createDroneIcon(L, iconColor));
        const start: [number, number] = [current.lat, current.lng];
        const end = nextPosition;
        const duration = 1800;
        const startTime = performance.now();
        const prevAnim = droneAnimationRef.current.get(drone.id);
        if (prevAnim) {
          cancelAnimationFrame(prevAnim);
        }
        const animate = (time: number) => {
          const progress = Math.min((time - startTime) / duration, 1);
          const lat = start[0] + (end[0] - start[0]) * progress;
          const lng = start[1] + (end[1] - start[1]) * progress;
          existing.setLatLng([lat, lng]);
          if (progress < 1) {
            const id = requestAnimationFrame(animate);
            droneAnimationRef.current.set(drone.id, id);
          }
        };
        const id = requestAnimationFrame(animate);
        droneAnimationRef.current.set(drone.id, id);
      } else {
        const popupContent = `
          <div style="min-width: 140px;">
            <div style="font-weight: 600;">${drone.name || drone.id}</div>
            <div style="font-size: 12px; color: #6b7280;">${drone.company?.name || 'Unknown company'}</div>
          </div>
        `;
        const marker = L.marker([drone.lat, drone.lng], {
          icon: createDroneIcon(L, iconColor),
        })
          .bindPopup(popupContent)
          .addTo(map);
        droneMarkersRef.current.set(drone.id, marker);
      }
      lastDronePositionRef.current.set(drone.id, nextPosition);
    });
  }, [displayDrones, mapReady]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map || !mapReady) return;

    if (!showRoutes) {
      droneRoutesRef.current.forEach((routeLine) => {
        routeLine.remove();
      });
      droneRoutesRef.current.clear();
      return;
    }

    const nextIds = new Set(displayDrones.map((drone) => drone.id));
    droneRoutesRef.current.forEach((routeLine, id) => {
      if (!nextIds.has(id)) {
        routeLine.remove();
        droneRoutesRef.current.delete(id);
      }
    });

    displayDrones.forEach((drone) => {
      const waypoints = drone.route_waypoints ?? [];
      const existing = droneRoutesRef.current.get(drone.id);

      if (waypoints.length === 0) {
        if (existing) {
          existing.remove();
          droneRoutesRef.current.delete(drone.id);
        }
        return;
      }

      const points = [
        [drone.lat, drone.lng] as [number, number],
        ...waypoints.map((point) => [point.lat, point.lng] as [number, number]),
      ];
      const color = getRouteColor(drone.id);
      const dashArray = drone.route_intent === 'charging' ? '6 6' : undefined;

      if (existing) {
        existing.setLatLngs(points);
        existing.setStyle({ color, dashArray });
      } else {
        const routeLine = L.polyline(points, {
          color,
          weight: 3,
          opacity: 0.65,
          dashArray,
        }).addTo(map);
        droneRoutesRef.current.set(drone.id, routeLine);
      }
    });
  }, [displayDrones, mapReady, showRoutes]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map || !mapReady || hasFitBoundsRef.current) return;

    const points = [
      ...displayDrones.map((drone) => [drone.lat, drone.lng] as [number, number]),
      ...displayNodes.map((node) => [node.lat, node.lng] as [number, number]),
    ];
    if (points.length === 0) return;

    const bounds = L.latLngBounds(points);
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
    requestAnimationFrame(() => {
      map.invalidateSize();
    });
    hasFitBoundsRef.current = true;
  }, [displayDrones, displayNodes, mapReady]);

  const loadData = async () => {
    try {
      const [dronesData, nodesData] = await Promise.all([getDrones(), getNodes()]);
      setApiAvailable(true);
      setDrones(dronesData);
      setNodes(nodesData);
    } catch (error) {
      toast.error('Failed to load fleet data');
      console.error(error);
      setApiAvailable(false);
      setDrones([]);
      setNodes([]);
    } finally {
      setLoading(false);
    }
  };

  const runSimulationCycle = async () => {
    try {
      const [currentDrones, currentNodes] = await Promise.all([getDrones(), getNodes()]);
      await runSimulation(currentDrones, currentNodes);
    } catch (error) {
      console.error('Simulation error:', error);
    }
  };

  const getBatteryBarColor = (battery: number) => {
    if (battery > 60) return 'bg-emerald-500';
    if (battery > 30) return 'bg-amber-500';
        return 'bg-rose-500';
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, { label: string; className: string }> = {
      idle: { label: 'Idle', className: 'bg-muted text-foreground' },
      flying: { label: 'Flying', className: 'bg-primary text-primary-foreground shadow-sm' },
      charging: { label: 'Charging', className: 'bg-amber-500 text-white shadow-sm' },
      en_route: { label: 'En Route', className: 'bg-sky-600 text-white shadow-sm' },
    };
    const config = variants[status] || variants.idle;
    return (
      <span className={`rounded-full px-3 py-1 text-xs font-semibold ${config.className}`}>
        {config.label}
      </span>
    );
  };
  return (
    <MainLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold gradient-text">Local Cluster Monitoring</h1>
            <p className="text-muted-foreground">Real-time drone fleet monitoring</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Activity className="h-4 w-4 animate-pulse text-primary" />
            <span>Live Updates</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Fleet Visualization
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden relative">
                <div ref={mapRef} className="absolute inset-0" />
                {!leafletReady && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    Leaflet failed to load. Check the script include in index.html.
                  </div>
                )}
              </div>
              <div className="mt-3 flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <div>
                  <div className="text-sm font-medium">Show optimal paths</div>
                  <div className="text-xs text-muted-foreground">
                    Toggle planned drone routes on the map.
                  </div>
                </div>
                <Switch checked={showRoutes} onCheckedChange={setShowRoutes} />
              </div>
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2">
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-primary">{displayDrones.length}</div>
                  <div className="text-xs text-muted-foreground">Total Drones</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-secondary">{displayNodes.length}</div>
                  <div className="text-xs text-muted-foreground">Charging Nodes</div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-chart-5">
                    {ownCompanyDrones.filter((d) => d.status === 'flying').length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {profile?.role === 'admin' ? 'Active Flights' : 'Your Active Flights'}
                  </div>
                </div>
                <div className="p-3 bg-muted rounded-lg">
                  <div className="text-2xl font-bold text-chart-4">
                    {ownCompanyDrones.filter((d) => d.status === 'charging').length}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {profile?.role === 'admin' ? 'Charging' : 'Your Charging'}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5" />
                Drone Status
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3 max-h-[520px] overflow-y-auto">
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full bg-muted" />
                  ))
                ) : profile?.role !== 'admin' && !ownCompanyId ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Join or create a company to view your fleet status.
                  </div>
                ) : droneStatusList.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    No drones found for your company yet.
                  </div>
                ) : (
                  droneStatusList.map((drone) => (
                    <div
                      key={drone.id}
                      className={`p-4 border rounded-xl bg-background shadow-sm ${
                        isHighlightedDrone(drone)
                          ? ''
                          : 'border-border opacity-85'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-flex h-2.5 w-2.5 rounded-full"
                              style={{
                                backgroundColor: isHighlightedDrone(drone) ? '#06a9e0' : '#111827',
                              }}
                            />
                            <span className="font-semibold text-sm">{drone.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {drone.company?.name || 'Unknown'}
                          </div>
                        </div>
                        {getStatusBadge(drone.status)}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                          <div
                            className={`h-full ${getBatteryBarColor(drone.battery)}`}
                            style={{ width: `${drone.battery}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">{drone.battery.toFixed(0)}%</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Charging Nodes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 w-full bg-muted" />
                ))
              ) : (
                displayNodes.map((node) => (
                  <div key={node.id} className="p-4 border border-border rounded-lg">
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <div className="font-medium">{node.name}</div>
                        <div className="text-xs text-muted-foreground">Platform-owned</div>
                      </div>
                      <Badge variant={node.current_load >= node.capacity ? 'destructive' : 'outline'}>
                        {node.current_load}/{node.capacity}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default FleetMapPage;
