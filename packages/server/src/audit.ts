import type { Sql } from './db/client.ts'

export async function audit(sql: Sql, actor: string, action: string, entityType: string, entityId: string | null, before: unknown, after: unknown) {
  await sql`insert into audit_log (actor, action, entity_type, entity_id, before, after)
    values (${actor}, ${action}, ${entityType}, ${entityId}, ${before == null ? null : sql.json(before as never)}, ${after == null ? null : sql.json(after as never)})`
}
