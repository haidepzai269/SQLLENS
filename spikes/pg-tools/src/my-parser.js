import mysql from "node-sql-parser/build/mysql";
const { Parser } = mysql;
export const parseMy = (sql) => new Parser().astify(sql, { database: "MySQL" });
