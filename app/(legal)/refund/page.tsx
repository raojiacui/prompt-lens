import { LegalDocument, policyMetadata } from "@/components/legal-document";

export const generateMetadata = () => policyMetadata("refund");

export default function RefundPage() {
  return <LegalDocument kind="refund" />;
}
