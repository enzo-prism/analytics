export type DashboardWindow = "d1" | "d7" | "d28";

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
