import { NextRequest, NextResponse } from "next/server";
import { auth, getAdminUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) return NextResponse.json({ error: "Unauthorized", isAdmin: false }, { status: 401 });

  const adminUser = await getAdminUser(session.user.id);
  return NextResponse.json({
    isAdmin: Boolean(adminUser),
    user: adminUser ? { id: adminUser.id, email: adminUser.email, role: adminUser.role } : null,
  });
}
