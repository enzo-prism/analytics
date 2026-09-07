/** Verified marketing sites; GA4 and Vercel metrics remain distinct. */
export type TrackedProject = {
  slug: string;
  name: string;
  url: string;
  gaPropertyId?: string;
  vercelProjectId: string;
};

export const TRACKED_PROJECTS: TrackedProject[] = [
  { slug: "joe-town", name: "Joe Town", url: "https://gojoetown.com", gaPropertyId: "546640674", vercelProjectId: "prj_chdnZ4YiyAFCv8odqpGeqWE4IGJa" },
  { slug: "peak", name: "Peak", url: "https://www.peaksurf.club", vercelProjectId: "prj_65OvV8kK0LQCOVrPZNpqQXnliBTM" },
  { slug: "marble", name: "Marble", url: "https://marble-fit.app", vercelProjectId: "prj_xTTnTzH7LDaVBJX4xJ19U7BLKqQf" },
  { slug: "midas", name: "Midas", url: "https://midas-by-prism.vercel.app", vercelProjectId: "prj_QE4cLtn3PWTWa2twMtpmpp5jXSn9" },
  { slug: "z0", name: "z0", url: "https://z0-site.vercel.app", vercelProjectId: "prj_QOECfFj09W6ibrFccXhXJqiTqdv0" },
  { slug: "zread", name: "zRead", url: "https://zread.dev", vercelProjectId: "prj_ogFuR6NUz7nDHd2UI27PN6wQpybs" },
];

export const trackedProjectId = (project: TrackedProject) =>
  project.gaPropertyId ?? `vercel-${project.slug}`;

export const findTrackedProject = (id: string) =>
  TRACKED_PROJECTS.find((project) => trackedProjectId(project) === id);
