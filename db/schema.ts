import {sqliteTable,text,integer} from 'drizzle-orm/sqlite-core';
export const fleetDemo=sqliteTable('fleet_demo',{id:text('id').primaryKey(),revision:integer('revision').notNull().default(0),payload:text('payload').notNull()});
