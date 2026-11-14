import { LegalDocument, policyMetadata } from "@/components/legal-document";

export const generateMetadata = () => policyMetadata("terms");

export default function TermsPage() {
  return <LegalDocument kind="terms" />;
}
