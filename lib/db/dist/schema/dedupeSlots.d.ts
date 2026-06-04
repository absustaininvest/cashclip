/**
 * Dedicated store for short-lived idempotency / dedupe slots (e.g. preventing
 * the same outbound support reply from being sent twice in quick succession).
 *
 * Deliberately separate from `login_attempts`: login throttling and outbound
 * dedupe are unrelated concerns, and conflating them in one table means tuning,
 * pruning, or schema changes to one can silently affect the other.
 */
export declare const dedupeSlots: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "dedupe_slots";
    schema: undefined;
    columns: {
        key: import("drizzle-orm/pg-core").PgColumn<{
            name: "key";
            tableName: "dedupe_slots";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        count: import("drizzle-orm/pg-core").PgColumn<{
            name: "count";
            tableName: "dedupe_slots";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        firstSeen: import("drizzle-orm/pg-core").PgColumn<{
            name: "first_seen";
            tableName: "dedupe_slots";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        expiresAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "expires_at";
            tableName: "dedupe_slots";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
export type DedupeSlot = typeof dedupeSlots.$inferSelect;
//# sourceMappingURL=dedupeSlots.d.ts.map