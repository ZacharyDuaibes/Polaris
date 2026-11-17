import React, { useEffect, useState, useRef } from 'react';
import MainLayout from '@/components/layouts/MainLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  getCompanies,
  getDrones,
  getNodes,
  createNode,
  registerDrone,
  deleteDrone,
  subscribeToDrones,
  subscribeToNodes,
} from '@/db/api';
import { useAuth } from '@/contexts/AuthContext';
import type { Node, DroneWithCompany, Company } from '@/types/database';
import { Network, Plus, TrendingDown, AlertCircle, MapPin, Trash2, Plane } from 'lucide-react';
import { toast } from 'sonner';
import { createDroneIcon, createNodeIcon, createPlacementPinIcon } from '@/lib/leafletIcons';
import { getRouteColor } from '@/lib/routeColors';
import {
  DEFAULT_MAP_CENTER,
  DEFAULT_MAP_ZOOM,
  OSM_TILE_ATTRIBUTION,
  OSM_TILE_URL,
} from '@/lib/mapTiles';
import { runSimulation } from '@/lib/simulation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Link } from 'react-router-dom';

const InfrastructurePlannerPage: React.FC = () => {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [drones, setDrones] = useState<DroneWithCompany[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [simulationMode, setSimulationMode] = useState(false);
  const [showRoutes, setShowRoutes] = useState(true);
  const [newNode, setNewNode] = useState({
    name: '',
    lat: 37.7749,
    lng: -122.4194,
    capacity: 5,
  });
  const [newDrone, setNewDrone] = useState({
    name: '',
    tier: 'starter' as 'starter' | 'pro' | 'enterprise',
    lat: 37.7749,
    lng: -122.4194,
    company_id: '',
  });
  const [dronePlacementSelected, setDronePlacementSelected] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const { profile } = useAuth();
  const simulationInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const dronesChannel = subscribeToDrones((payload) => {
      setDrones(payload.data);
    });

    const nodesChannel = subscribeToNodes((payload) => {
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
    if (profile?.role !== 'admin') {
      setNewDrone((prev) => ({
        ...prev,
        company_id: profile?.company_id ?? '',
      }));
    }
  }, [profile]);

  const loadData = async () => {
    try {
      const [nodesData, dronesData, companiesData] = await Promise.all([
        getNodes(),
        getDrones(),
        getCompanies(),
      ]);
      setNodes(nodesData);
      setDrones(dronesData);
      setCompanies(companiesData);
    } catch (error) {
      toast.error('Failed to load infrastructure data');
      console.error(error);
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

  const handleSimulateNode = () => {
    if (!newNode.name || !newNode.lat || !newNode.lng) {
      toast.error('Please fill in all fields');
      return;
    }

    setSimulationMode(true);
    toast.success('Simulating node placement impact...');
  };

  const handleCreateNode = async () => {
    if (!newNode.name || !newNode.lat || !newNode.lng) {
      toast.error('Please fill in all fields');
      return;
    }

    if (profile?.role !== 'admin') {
      toast.error('Only admins can create nodes');
      return;
    }

    try {
      await createNode(
        {
          name: newNode.name,
          lat: newNode.lat,
          lng: newNode.lng,
          capacity: newNode.capacity,
        },
        profile?.role ?? null
      );
      toast.success('Node created successfully');
      setNewNode({
        name: '',
        lat: 37.7749,
        lng: -122.4194,
        capacity: 5,
      });
      setSimulationMode(false);
      loadData();
    } catch (error) {
      toast.error('Failed to create node');
      console.error(error);
    }
  };

  const handleRegisterDrone = async () => {
    if (!newDrone.name) {
      toast.error('Please enter a drone name');
      return;
    }

    const companyId =
      profile?.role === 'admin' ? newDrone.company_id : profile?.company_id;

    if (!companyId) {
      toast.error('Please select a company for this drone');
      return;
    }

    setRegistering(true);
    try {
      const response = await registerDrone(
        {
          name: newDrone.name,
          company_id: companyId,
          tier: newDrone.tier,
          lat: newDrone.lat,
          lng: newDrone.lng,
        },
        profile?.role ?? null
      );
      toast.success(`Drone registered. ${response.amount_sol} SOL charged.`);
      setNewDrone((prev) => ({
        ...prev,
        name: '',
      }));
      setDronePlacementSelected(false);
      loadData();
    } catch (error) {
      toast.error('Failed to register drone');
      console.error(error);
    } finally {
      setRegistering(false);
    }
  };

  const handleRemoveDrone = async (id: string) => {
    setRemovingId(id);
    try {
      await deleteDrone(id);
      toast.success('Drone removed from fleet');
      loadData();
    } catch (error) {
      toast.error('Failed to remove drone');
      console.error(error);
    } finally {
      setRemovingId(null);
    }
  };

  const calculateImpact = () => {
    const avgDeliveryTimeReduction = Math.random() * 15 + 5;
    const batteryFailurePrevention = Math.floor(Math.random() * 3 + 1);
    const congestionReduction = Math.random() * 20 + 10;

    return {
      deliveryTimeReduction: avgDeliveryTimeReduction.toFixed(1),
      batteryFailurePrevention,
      congestionReduction: congestionReduction.toFixed(1),
    };
  };

  const impact = simulationMode ? calculateImpact() : null;
  const isAdmin = profile?.role === 'admin';
  const companyIdForDrone = isAdmin ? newDrone.company_id : profile?.company_id ?? '';
  const canRegisterDrone = Boolean(companyIdForDrone);

  const visibleDrones = isAdmin
    ? drones
    : drones.filter((drone) => drone.company_id && drone.company_id === profile?.company_id);

  const mapRef = useRef<HTMLDivElement | null>(null);
  const leafletMapRef = useRef<any>(null);
  const nodeMarkersRef = useRef<Map<string, any>>(new Map());
  const droneMarkersRef = useRef<Map<string, any>>(new Map());
  const droneRoutesRef = useRef<Map<string, any>>(new Map());
  const droneAnimationRef = useRef<Map<string, number>>(new Map());
  const lastDronePositionRef = useRef<Map<string, [number, number]>>(new Map());
  const previewMarkerRef = useRef<any>(null);
  const dronePreviewMarkerRef = useRef<any>(null);
  const droneSelectionRingRef = useRef<any>(null);
  const selectedCompanyName =
    companies.find((company) => company.id === profile?.company_id)?.name || 'No company assigned';

  useEffect(() => {
    const L = (window as any).L;
    if (!L || !mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      center: [newNode.lat || DEFAULT_MAP_CENTER[0], newNode.lng || DEFAULT_MAP_CENTER[1]],
      zoom: DEFAULT_MAP_ZOOM,
      zoomControl: false,
      attributionControl: false,
    });
    leafletMapRef.current = map;

    L.tileLayer(OSM_TILE_URL, {
      attribution: OSM_TILE_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    requestAnimationFrame(() => {
      map.invalidateSize();
    });

    map.on('click', (event: { latlng: { lat: number; lng: number } }) => {
      const { lat, lng } = event.latlng;
      map.panTo([lat, lng], { animate: true, duration: 0.4 });

      if (profile?.role === 'admin') {
        setNewNode((prev) => ({
          ...prev,
          lat: Number(lat.toFixed(4)),
          lng: Number(lng.toFixed(4)),
        }));
        return;
      }

      setNewDrone((prev) => ({
        ...prev,
        lat: Number(lat.toFixed(4)),
        lng: Number(lng.toFixed(4)),
      }));
      setDronePlacementSelected(true);
    });

    return () => {
      if (droneSelectionRingRef.current) {
        droneSelectionRingRef.current.remove();
        droneSelectionRingRef.current = null;
      }
      if (dronePreviewMarkerRef.current) {
        dronePreviewMarkerRef.current.remove();
        dronePreviewMarkerRef.current = null;
      }
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [profile?.role]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    const nextIds = new Set(nodes.map((node) => node.id));
    nodeMarkersRef.current.forEach((marker, id) => {
      if (!nextIds.has(id)) {
        marker.remove();
        nodeMarkersRef.current.delete(id);
      }
    });

    nodes.forEach((node) => {
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
  }, [nodes]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    const nextIds = new Set(visibleDrones.map((drone) => drone.id));
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

    visibleDrones.forEach((drone) => {
      const existing = droneMarkersRef.current.get(drone.id);
      const nextPosition: [number, number] = [drone.lat, drone.lng];
      const current = existing ? existing.getLatLng() : { lat: drone.lat, lng: drone.lng };
      if (existing) {
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
          icon: createDroneIcon(L),
        })
          .bindPopup(popupContent)
          .addTo(map);
        droneMarkersRef.current.set(drone.id, marker);
      }
      lastDronePositionRef.current.set(drone.id, nextPosition);
    });
  }, [visibleDrones]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (!showRoutes) {
      droneRoutesRef.current.forEach((routeLine) => {
        routeLine.remove();
      });
      droneRoutesRef.current.clear();
      return;
    }

    const nextIds = new Set(visibleDrones.map((drone) => drone.id));
    droneRoutesRef.current.forEach((routeLine, id) => {
      if (!nextIds.has(id)) {
        routeLine.remove();
        droneRoutesRef.current.delete(id);
      }
    });

    visibleDrones.forEach((drone) => {
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
  }, [visibleDrones, showRoutes]);

  useEffect(() => {
    const L = (window as any).L;
    const map = leafletMapRef.current;
    if (!L || !map) return;

    if (profile?.role === 'admin') {
      if (!previewMarkerRef.current) {
        previewMarkerRef.current = L.marker([newNode.lat, newNode.lng], {
          icon: createNodeIcon(L, 0.6),
          opacity: 0.7,
        }).addTo(map);
      } else {
        previewMarkerRef.current.setLatLng([newNode.lat, newNode.lng]);
      }
    } else {
      if (previewMarkerRef.current) {
        previewMarkerRef.current.remove();
        previewMarkerRef.current = null;
      }
    }

    if (profile?.role !== 'admin' && dronePlacementSelected) {
      if (!dronePreviewMarkerRef.current) {
        dronePreviewMarkerRef.current = L.marker([newDrone.lat, newDrone.lng], {
          icon: createPlacementPinIcon(L),
          opacity: 1,
          zIndexOffset: 1200,
        }).addTo(map);
        dronePreviewMarkerRef.current.bindPopup('Selected drone location');
      } else {
        dronePreviewMarkerRef.current.setLatLng([newDrone.lat, newDrone.lng]);
      }

      if (!droneSelectionRingRef.current) {
        droneSelectionRingRef.current = L.circleMarker([newDrone.lat, newDrone.lng], {
          radius: 12,
          color: '#06a9e0',
          weight: 3,
          fillColor: '#06a9e0',
          fillOpacity: 0.12,
        }).addTo(map);
      } else {
        droneSelectionRingRef.current.setLatLng([newDrone.lat, newDrone.lng]);
      }

      dronePreviewMarkerRef.current.openPopup();
    } else {
      if (dronePreviewMarkerRef.current) {
        dronePreviewMarkerRef.current.remove();
        dronePreviewMarkerRef.current = null;
      }
      if (droneSelectionRingRef.current) {
        droneSelectionRingRef.current.remove();
        droneSelectionRingRef.current = null;
      }
    }
  }, [newNode.lat, newNode.lng, newDrone.lat, newDrone.lng, profile?.role, dronePlacementSelected]);

  return (
    <MainLayout>
      <div className="container mx-auto p-4 space-y-4">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Infrastructure Planner</h1>
          <p className="text-muted-foreground">
            Plan and simulate new charging node placements
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="h-5 w-5" />
                Node Placement Simulator
              </CardTitle>
              <CardDescription>
                Visualize potential node locations and their impact
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="aspect-video bg-muted rounded-lg overflow-hidden mb-4 relative">
                <div ref={mapRef} className="absolute inset-0" />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 mb-4">
                <div>
                  <div className="text-sm font-medium">Show optimal paths</div>
                  <div className="text-xs text-muted-foreground">
                    Toggle planned drone routes on the map.
                  </div>
                </div>
                <Switch checked={showRoutes} onCheckedChange={setShowRoutes} />
              </div>

              {simulationMode && impact && (
                <div className="space-y-3 p-4 bg-accent/50 rounded-lg border border-border">
                  <div className="font-medium flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 text-primary" />
                    Simulated Impact Analysis
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div className="p-3 bg-background rounded-lg">
                      <div className="flex items-center gap-2 text-chart-5">
                        <TrendingDown className="h-4 w-4" />
                        <span className="text-xl font-bold">{impact.deliveryTimeReduction}%</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Delivery time reduction
                      </div>
                    </div>
                    <div className="p-3 bg-background rounded-lg">
                      <div className="flex items-center gap-2 text-chart-5">
                        <TrendingDown className="h-4 w-4" />
                        <span className="text-xl font-bold">{impact.batteryFailurePrevention}</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Battery failures prevented
                      </div>
                    </div>
                    <div className="p-3 bg-background rounded-lg">
                      <div className="flex items-center gap-2 text-chart-5">
                        <TrendingDown className="h-4 w-4" />
                        <span className="text-xl font-bold">{impact.congestionReduction}%</span>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1">
                        Congestion reduction
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {isAdmin ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plus className="h-5 w-5" />
                  New Node Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="node-name">Node Name</Label>
                  <Input
                    id="node-name"
                    placeholder="e.g., Node-SF-06"
                    value={newNode.name}
                    onChange={(e) => setNewNode({ ...newNode, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="node-lat">Latitude</Label>
                    <Input
                      id="node-lat"
                      type="number"
                      step="0.0001"
                      value={newNode.lat}
                      onChange={(e) => setNewNode({ ...newNode, lat: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="node-lng">Longitude</Label>
                    <Input
                      id="node-lng"
                      type="number"
                      step="0.0001"
                      value={newNode.lng}
                      onChange={(e) => setNewNode({ ...newNode, lng: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="node-capacity">Capacity</Label>
                  <Input
                    id="node-capacity"
                    type="number"
                    min="1"
                    max="20"
                    value={newNode.capacity}
                    onChange={(e) => setNewNode({ ...newNode, capacity: parseInt(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Button onClick={handleSimulateNode} variant="outline" className="w-full">
                    Simulate Impact
                  </Button>
                  <Button onClick={handleCreateNode} className="w-full">
                    Create Node
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Plane className="h-5 w-5" />
                  Drone Registration
                </CardTitle>
                <CardDescription>Register drones and simulate subscription purchases</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="drone-name">Drone Name</Label>
                  <Input
                    id="drone-name"
                    placeholder="e.g., Drone-Zeta"
                    value={newDrone.name}
                    onChange={(e) => setNewDrone({ ...newDrone, name: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="drone-lat">Latitude</Label>
                    <Input
                      id="drone-lat"
                      type="number"
                      step="0.0001"
                      value={newDrone.lat}
                      onChange={(e) => setNewDrone({ ...newDrone, lat: parseFloat(e.target.value) })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="drone-lng">Longitude</Label>
                    <Input
                      id="drone-lng"
                      type="number"
                      step="0.0001"
                      value={newDrone.lng}
                      onChange={(e) => setNewDrone({ ...newDrone, lng: parseFloat(e.target.value) })}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Subscription Tier</Label>
                  <Select
                    value={newDrone.tier}
                    onValueChange={(value) =>
                      setNewDrone({ ...newDrone, tier: value as 'starter' | 'pro' | 'enterprise' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select tier" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="starter">Starter - 0.5 SOL</SelectItem>
                      <SelectItem value="pro">Pro - 1.25 SOL</SelectItem>
                      <SelectItem value="enterprise">Enterprise - 2.5 SOL</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>
                    {selectedCompanyName}{' '}
                    <Link to="/settings" className="text-xs text-primary underline underline-offset-4">
                      Manage in Settings
                    </Link>
                  </Label>
                </div>
                <Button
                  onClick={handleRegisterDrone}
                  className="w-full"
                  disabled={registering || !canRegisterDrone}
                >
                  {registering ? 'Registering...' : 'Register Drone'}
                </Button>
                {!canRegisterDrone && (
                  <div className="text-xs text-muted-foreground">
                    You must register with a company before creating drones.
                  </div>
                )}
                <div className="space-y-2">
                  <div className="text-sm font-medium">Subscription Notes</div>
                  <div className="text-xs text-muted-foreground">
                    Starter: essentials for small fleets. Pro: higher throughput analytics. Enterprise:
                    priority support and SLA.
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              Existing Infrastructure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {nodes.map((node) => (
                <div key={node.id} className="p-4 border border-border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{node.name}</div>
                      <div className="text-xs text-muted-foreground">Platform-owned</div>
                    </div>
                    <Badge variant={node.current_load >= node.capacity ? 'destructive' : 'outline'}>
                      {node.current_load}/{node.capacity}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    📍 {node.lat.toFixed(4)}, {node.lng.toFixed(4)}
                  </div>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full ${
                        node.current_load >= node.capacity
                          ? 'bg-destructive'
                          : 'bg-primary'
                      }`}
                      style={{ width: `${(node.current_load / node.capacity) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plane className="h-5 w-5" />
              Registered Drones
            </CardTitle>
            <CardDescription>
              {profile?.role === 'admin'
                ? 'Viewing all drones across companies.'
                : 'Viewing drones registered to your company.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {visibleDrones.map((drone) => (
                <div key={drone.id} className="p-4 border border-border rounded-lg space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-medium">{drone.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {drone.company?.name || 'Unknown company'}
                      </div>
                    </div>
                    <Badge variant="outline">{drone.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    📍 {drone.lat.toFixed(4)}, {drone.lng.toFixed(4)}
                  </div>
                  <div className="text-xs text-muted-foreground">Battery: {drone.battery.toFixed(0)}%</div>
                  {(profile?.role === 'admin' || drone.company_id === profile?.company_id) && (
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => handleRemoveDrone(drone.id)}
                      disabled={removingId === drone.id}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      {removingId === drone.id ? 'Removing...' : 'Remove Drone'}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </MainLayout>
  );
};

export default InfrastructurePlannerPage;
