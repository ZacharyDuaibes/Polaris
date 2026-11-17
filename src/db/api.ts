import type {
  Company,
  Profile,
  Node,
  Drone,
  RouteIntent,
  RouteWaypoint,
  Transaction,
  DroneWithCompany,
  TransactionWithDetails,
  NetworkMetrics,
} from '@/types/database';
import { apiFetch } from './client';

export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  created_at: string;
}

export interface AuthResponse {
  user: AuthUser;
  profile: Profile;
}

export interface SyncPayload<T> {
  type: 'sync';
  data: T;
}

export interface RealtimeSubscription {
  unsubscribe: () => void;
}

export const signUp = async (username: string, password: string): Promise<AuthResponse> => {
  return apiFetch<AuthResponse>('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

export const signIn = async (username: string, password: string): Promise<AuthResponse> => {
  return apiFetch<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
};

// Companies API
export const getCompanies = async (): Promise<Company[]> => {
  return apiFetch<Company[]>('/api/companies');
};

export const createCompany = async (name: string): Promise<Company> => {
  return apiFetch<Company>('/api/companies', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
};

export const associateProfileCompany = async (profileId: string, companyId: string): Promise<Profile> => {
  return apiFetch<Profile>(`/api/profiles/${profileId}/company`, {
    method: 'POST',
    body: JSON.stringify({ company_id: companyId }),
  });
};

export const leaveCompany = async (profileId: string): Promise<Profile> => {
  return apiFetch<Profile>(`/api/profiles/${profileId}/company`, {
    method: 'DELETE',
  });
};

export const getCompanyById = async (id: string): Promise<Company | null> => {
  return apiFetch<Company | null>(`/api/companies/${id}`);
};

// Profiles API
export const getProfileById = async (id: string): Promise<Profile | null> => {
  return apiFetch<Profile | null>(`/api/profiles/${id}`);
};

export const getProfileByUsername = async (username: string): Promise<Profile | null> => {
  return apiFetch<Profile | null>(`/api/profiles/by-username/${encodeURIComponent(username)}`);
};

export const getAllProfiles = async (): Promise<Profile[]> => {
  return apiFetch<Profile[]>('/api/profiles');
};

export const upsertProfile = async (profile: Profile): Promise<Profile> => {
  return apiFetch<Profile>('/api/profiles', {
    method: 'POST',
    body: JSON.stringify(profile),
  });
};

export const updateProfile = async (id: string, updates: Partial<Profile>): Promise<void> => {
  await apiFetch<void>(`/api/profiles/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
};

// Nodes API
export const getNodes = async (): Promise<Node[]> => {
  return apiFetch<Node[]>('/api/nodes');
};

export const getNodeById = async (id: string): Promise<Node | null> => {
  return apiFetch<Node | null>(`/api/nodes/${id}`);
};

export const createNode = async (
  node: Omit<Node, 'id' | 'created_at' | 'current_load'>,
  role: string | null
): Promise<Node> => {
  return apiFetch<Node>('/api/nodes', {
    method: 'POST',
    headers: role ? { 'x-user-role': role } : undefined,
    body: JSON.stringify(node),
  });
};

export const updateNodeLoad = async (id: string, load: number): Promise<void> => {
  await apiFetch<void>(`/api/nodes/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ current_load: load }),
  });
};

// Drones API
export const getDrones = async (): Promise<DroneWithCompany[]> => {
  return apiFetch<DroneWithCompany[]>('/api/drones');
};

export const getDroneById = async (id: string): Promise<Drone | null> => {
  return apiFetch<Drone | null>(`/api/drones/${id}`);
};

export const updateDrone = async (id: string, updates: Partial<Drone>): Promise<void> => {
  await apiFetch<void>(`/api/drones/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
};

export interface DroneRegistrationPayload {
  name: string;
  company_id: string;
  tier: 'starter' | 'pro' | 'enterprise';
  lat?: number;
  lng?: number;
}

export interface DroneRegistrationResponse {
  drone: Drone;
  tier: 'starter' | 'pro' | 'enterprise';
  amount_sol: number;
}

export const registerDrone = async (
  payload: DroneRegistrationPayload,
  role: string | null
): Promise<DroneRegistrationResponse> => {
  return apiFetch<DroneRegistrationResponse>('/api/drones', {
    method: 'POST',
    headers: role ? { 'x-user-role': role } : undefined,
    body: JSON.stringify(payload),
  });
};

export const deleteDrone = async (id: string): Promise<void> => {
  await apiFetch<void>(`/api/drones/${id}`, {
    method: 'DELETE',
  });
};

export const updateDronePosition = async (
  id: string,
  lat: number,
  lng: number,
  battery: number,
  status: string,
  extras?: {
    waypoints?: RouteWaypoint[] | null;
    intent?: RouteIntent;
    current_node_id?: string | null;
    destination_lat?: number | null;
    destination_lng?: number | null;
  }
): Promise<void> => {
  const routePayload =
    extras && (extras.waypoints !== undefined || extras.intent !== undefined)
      ? {
          route_waypoints: extras.waypoints ?? null,
          route_intent: extras.intent ?? null,
        }
      : {};
  const nodePayload =
    extras && extras.current_node_id !== undefined
      ? { current_node_id: extras.current_node_id }
      : {};
  const destinationPayload =
    extras && (extras.destination_lat !== undefined || extras.destination_lng !== undefined)
      ? {
          destination_lat: extras.destination_lat ?? null,
          destination_lng: extras.destination_lng ?? null,
        }
      : {};
  await apiFetch<void>(`/api/drones/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      lat,
      lng,
      battery,
      status,
      ...routePayload,
      ...nodePayload,
      ...destinationPayload,
      updated_at: new Date().toISOString(),
    }),
  });
};

// Transactions API
const resolveCompanyId = (companyContext?: CompanyContext): string | null => {
  return companyContext?.id ?? companyContext?.company_id ?? null;
};

export const getTransactions = async (
  limit = 50,
  companyContext?: CompanyContext
): Promise<TransactionWithDetails[]> => {
  const companyId = resolveCompanyId(companyContext);
  const suffix = companyId
    ? `/api/transactions?limit=${limit}&company_id=${encodeURIComponent(companyId)}`
    : `/api/transactions?limit=${limit}`;
  return apiFetch<TransactionWithDetails[]>(suffix);
};

export const createTransaction = async (
  droneId: string,
  nodeId: string,
  companyId: string,
  amountSol: number
): Promise<void> => {
  await apiFetch<void>('/api/transactions', {
    method: 'POST',
    body: JSON.stringify({
      drone_id: droneId,
      node_id: nodeId,
      company_id: companyId,
      amount_sol: amountSol,
    }),
  });
};

// Analytics API
export interface CompanyContext {
  id?: string | null;
  company_id?: string | null;
}

export const getNetworkMetrics = async (companyContext?: CompanyContext): Promise<NetworkMetrics> => {
  const companyId = resolveCompanyId(companyContext);
  const suffix = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  return apiFetch<NetworkMetrics>(`/api/metrics${suffix}`);
};

export interface AIRecommendation {
  title: string;
  description: string;
  impact: string;
  priority: 'high' | 'medium' | 'low';
}

export interface AIAnalysis {
  recommendations: AIRecommendation[];
  summary: string;
}

export const generateAIAnalysis = async (
  networkData: NetworkMetrics & { most_congested_node?: string },
  companyContext?: CompanyContext
): Promise<AIAnalysis> => {
  return apiFetch<AIAnalysis>('/api/ai-analytics', {
    method: 'POST',
    body: JSON.stringify({ networkData, companyContext }),
  });
};

export interface TextToSpeechResponse {
  audioBase64?: string | null;
  message?: string;
}

export const generateVoiceExplanation = async (text: string): Promise<TextToSpeechResponse> => {
  return apiFetch<TextToSpeechResponse>('/api/text-to-speech', {
    method: 'POST',
    body: JSON.stringify({ text }),
  });
};

// Pseudo real-time subscriptions (polling)
const createPollingSubscription = <T>(
  fetcher: () => Promise<T>,
  callback: (payload: SyncPayload<T>) => void,
  intervalMs = 4000
): RealtimeSubscription => {
  let active = true;

  const tick = async () => {
    if (!active) return;
    try {
      const data = await fetcher();
      callback({ type: 'sync', data });
    } catch (error) {
      console.error('Polling subscription error:', error);
    }
  };

  void tick();
  const interval = setInterval(tick, intervalMs);

  return {
    unsubscribe: () => {
      active = false;
      clearInterval(interval);
    },
  };
};

export const subscribeToDrones = (callback: (payload: SyncPayload<DroneWithCompany[]>) => void): RealtimeSubscription => {
  return createPollingSubscription(getDrones, callback);
};

export const subscribeToTransactions = (
  callback: (payload: SyncPayload<TransactionWithDetails[]>) => void,
  companyContext?: CompanyContext
): RealtimeSubscription => {
  return createPollingSubscription(() => getTransactions(100, companyContext), callback, 6000);
};

export const subscribeToNodes = (callback: (payload: SyncPayload<Node[]>) => void): RealtimeSubscription => {
  return createPollingSubscription(getNodes, callback);
};
