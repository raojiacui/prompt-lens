export type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  priceCny: number;
  description: string;
};

export const CREDIT_PACKAGES: CreditPackage[] = [
  {
    id: "starter_10",
    name: "体验包",
    credits: 10,
    priceCny: 9.9,
    description: "适合测试长视频拆镜和少量镜头分析",
  },
  {
    id: "creator_30",
    name: "创作者包",
    credits: 30,
    priceCny: 29,
    description: "适合日常短视频分析，一个镜头默认扣 1 积分，AI 修改脚本免费",
  },
  {
    id: "studio_80",
    name: "工作室包",
    credits: 80,
    priceCny: 42,
    description: "适合批量分析 2-3 分钟长视频和多镜头项目，AI 修改脚本免费",
  },
  {
    id: "pro_220",
    name: "专业包",
    credits: 220,
    priceCny: 105,
    description: "适合高频创作和团队集中使用，AI 修改脚本免费",
  },
];

export function getCreditPackage(packageId: string | null | undefined) {
  if (!packageId) return null;
  return CREDIT_PACKAGES.find((item) => item.id === packageId) || null;
}