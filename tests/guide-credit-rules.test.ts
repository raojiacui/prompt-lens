import { describe, expect, it } from "vitest";
import { guideContent } from "@/app/guide/content";

describe("Published credit rules", () => {
  it.each(["zh", "en"] as const)("keeps %s fees free of formulas and internal billing steps", locale => {
    const section = guideContent[locale].find(s => s.id === "credits")!;
    const text = JSON.stringify(section);
    expect(text).not.toMatch(/向上取整|×|÷|总费用＝|总积分＝|预留|后台检测|ceiling\(|reservation|reserved|server probes|From quote to settlement/i);
  });

  it.each(["zh", "en"] as const)("publishes live pricing and allowances in %s", locale => {
    const topics = guideContent[locale].find(s => s.id === "credits")!.topics;
    const tables = topics.filter(t => t.table).map(t => t.table!);
    expect(tables).toHaveLength(8);
    for (const table of tables) for (const row of table.rows) expect(row).toHaveLength(table.columns.length);
    expect(tables[0].rows.map(r => r.slice(1))).toEqual([["21.90", "200", "20", "12"], ["63.90", "650", "60", "30"], ["139.00", "1500", "150", "61"]]);
    expect(tables[3].rows.find(r => r[0] === "Wan 2.6" && r[1] === "720p")?.[3]).toBe("40");
    expect(tables[3].rows.find(r => r[0] === "Seedance Fast")?.[3]).toBe("65");
    expect(tables[5].rows).toEqual([["Veo 3.1 Lite", "20", "20", "75"], ["Veo 3.1 Fast", "35", "35", "90"], ["Veo 3.1 Quality", "125", "130", "-"]]);
    expect(tables[6].rows.find(r => r[0] === "Seedance Fast")?.[3]).toBe("115");
    expect(tables[7].rows.find(r => r[0] === "Wan 2.7")?.[4]).toBe("-");
    expect(tables[1].rows.map(r => r[1])).toEqual(["1", "2", "5", "10"]);
    expect(tables[2].columns).toHaveLength(3);
    expect(tables[2].columns[1]).toContain("Gemini 3.8 Flash");
    expect(tables[2].columns[2]).toContain("Gemini 2.5 Pro");
    expect(tables[2].rows.map(r => r.slice(1))).toEqual([["2", "3"], ["3", "5"], ["5", "7"]]);
    expect(tables[2].columns.join(" ")).not.toMatch(/总积分|total/i);
  });
});
