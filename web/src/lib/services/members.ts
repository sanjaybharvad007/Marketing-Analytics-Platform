import { asc } from "drizzle-orm";
import { db } from "@/db/client";
import { members } from "@/db/schema";

export interface Member {
  id: number;
  name: string;
  email: string;
  role: string;
  color: string;
}

export type MemberRef = Pick<Member, "id" | "name" | "color">;

export async function listMembers(): Promise<Member[]> {
  return db
    .select({
      id: members.id,
      name: members.name,
      email: members.email,
      role: members.role,
      color: members.color,
    })
    .from(members)
    .orderBy(asc(members.name));
}
