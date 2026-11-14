import { LegalDocument, policyMetadata } from "@/components/legal-document";

export const generateMetadata = () => policyMetadata("privacy");

export default function PrivacyPage() {
  return <LegalDocument kind="privacy" />;
}
