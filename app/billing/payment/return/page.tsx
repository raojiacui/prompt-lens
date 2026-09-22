import { Suspense } from "react";
import { PaymentReturnClient } from "./payment-return-client";

export default function AlipayReturnPage() {
  return <Suspense fallback={<main className="flex min-h-screen items-center justify-center text-foreground">Loading...</main>}>
    <PaymentReturnClient />
  </Suspense>;
}
