import PropertyDetailClient from "./property-detail-client";

type PropertyPageProps = {
  params: { propertyId: string };
};

export default function PropertyPage({ params }: PropertyPageProps) {
  return <PropertyDetailClient propertyId={params.propertyId} />;
}
