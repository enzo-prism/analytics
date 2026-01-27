export type DashboardWindow = "d1" | "d7" | "d28" | "d90" | "d180" | "d365";
export type TotalWindow = "d7" | "d30" | "d60" | "d90" | "d365";

export type NewUsersDelta = {
  current: number;
  previous: number;
  delta: number;
  pct: number | null;
};

export type DashboardProperty = {
  propertyId: string;
  displayName: string;
  defaultUri: string | null;
  emoji: string;
  newUsers: NewUsersDelta | null;
  error: string | null;
};

export type DashboardResponse = {
  updatedAt: string;
  window: DashboardWindow;
  properties: DashboardProperty[];
};

export type TotalResponse = {
  updatedAt: string;
  window: TotalWindow;
  total: number;
  propertyCount: number;
  errorCount: number;
};

export type PropertySeriesPoint = {
  date: string;
  current: number;
  previous: number;
};

export type PropertyDetail = {
  propertyId: string;
  displayName: string;
  defaultUri: string | null;
  emoji: string;
};

export type PropertyDetailResponse = {
  updatedAt: string;
  window: DashboardWindow;
  property: PropertyDetail;
  summary: NewUsersDelta | null;
  series: PropertySeriesPoint[];
  error: string | null;
};
