import PropertyDetailClient from "./property-detail-client";

type PropertyPageProps = {
  params: Promise<{ propertyId: string }>;
};

export default async function PropertyPage({ params }: PropertyPageProps) {
  const { propertyId } = await params;
  return <PropertyDetailClient propertyId={propertyId} />;
}
