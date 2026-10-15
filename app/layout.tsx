import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "成績分析室",
  description: "按班別管理學生，輸入分數，查看成績分佈及預測等級。",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-HK"><body>{children}</body></html>;
}
