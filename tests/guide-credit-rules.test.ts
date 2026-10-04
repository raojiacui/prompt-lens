import { describe, expect, it } from "vitest";
import { guideContent } from "@/app/guide/content";

describe("Published credit rules", () => {
  it.each(["zh", "en"] as const)("publishes live pricing and allowances in %s", locale => {
    const topics = guideContent[locale].find(s => s.id === "credits")!.topics;
    const tables = topics.filter(t => t.table).map(t => t.table!);
    expect(tables).toHaveLength(6);
    for (const table of tables) for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    expect(tables[0].rows.map(r => r.slice(1))).toEqual([["21.90", "200", "20", "12"], ["63.90", "650", "60", "30"], ["139.00", "1500", "150", "61"]]);
    expect(tables[2].rows.find(r => r[0] === "Wan 2.6" && r[1] === "720p")?.[3]).toBe("40");
    expect(tables[2].rows.find(r => r[0] === "Seedance Fast")?.[3]).toBe("65");
    expect(tables[4].rows.find(r => r[0] === "Seedance Fast")?.[3]).toBe("115");
    expect(tables[5].rows.find(r => r[0] === "Wan 2.7")?.[4]).toBe("-");
    expect(tables[1].rows.map(r => r.slice(3))).toEqual([["5", "7"], ["7", "9"], ["23", "32"], ["54", "80"]]);
  });
});
