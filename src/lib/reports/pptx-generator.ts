import PptxGenJS from "pptxgenjs";
import { ReportBucket, MeasureKey, MEASURES } from "@/lib/citrusad/types";

const NAVY = "00275B";
const GREEN = "689700";
const LIGHT_BLUE = "ECF5FE";
const WHITE = "FFFFFF";

interface PptxReportOptions {
  teamName: string;
  dateFrom: string;
  dateTo: string;
  buckets: ReportBucket[];
  measures: MeasureKey[];
  analysis?: string;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
}

function formatNumber(value: number): string {
  if (value >= 1000000) return (value / 1000000).toFixed(1) + "M";
  if (value >= 1000) return (value / 1000).toFixed(1) + "K";
  if (value % 1 !== 0) return value.toFixed(2);
  return value.toString();
}

function getMeasureLabel(key: MeasureKey): string {
  const labels: Record<MeasureKey, string> = {
    Impressions: "Imprese",
    Clicks: "Kliky",
    Spend: "Náklady",
    ROAS: "ROAS",
    CTR: "CTR",
    CPC: "CPC",
    CPM: "CPM",
    Revenue: "Tržby",
    Conversions: "Konverze",
    ConversionRate: "Konverzní poměr",
    CPA: "CPA",
    AvgPosition: "Prům. pozice",
    ActiveProducts: "Aktivní produkty",
    AdRevenue: "Příjmy z reklam",
    RevenuePerClick: "Tržby/klik",
  };
  return labels[key] || key;
}

function getMeasureUnit(key: MeasureKey): string {
  const units: Partial<Record<MeasureKey, string>> = {
    Spend: "CZK",
    CPC: "CZK",
    CPM: "CZK",
    Revenue: "CZK",
    CPA: "CZK",
    AdRevenue: "CZK",
    RevenuePerClick: "CZK",
    CTR: "%",
    ConversionRate: "%",
    ROAS: "x",
  };
  return units[key] || "";
}

export function generatePptxReport(options: PptxReportOptions): PptxGenJS {
  const { teamName, dateFrom, dateTo, buckets, measures, analysis } = options;
  const pptx = new PptxGenJS();

  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Brain";
  pptx.title = `AlzaAds Report: ${teamName}`;

  // Compute totals
  const totals: Record<string, number> = {};
  for (const bucket of buckets) {
    for (const m of bucket.overallMeasures) {
      totals[m.measure] = (totals[m.measure] || 0) + m.measuredValue;
    }
  }

  // --- Title Slide ---
  const titleSlide = pptx.addSlide();
  titleSlide.addShape("rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: 1.2,
    fill: { color: NAVY },
  });
  titleSlide.addText("alzaAds", {
    x: 0.5,
    y: 0.2,
    w: 3,
    h: 0.6,
    fontSize: 24,
    fontFace: "Calibri",
    color: GREEN,
    bold: true,
  });
  titleSlide.addText(teamName, {
    x: 0.5,
    y: 2.0,
    w: 9,
    h: 1.2,
    fontSize: 36,
    fontFace: "Calibri",
    color: NAVY,
    bold: true,
  });
  titleSlide.addText(
    `Report: ${formatDate(dateFrom)} - ${formatDate(dateTo)}`,
    {
      x: 0.5,
      y: 3.2,
      w: 9,
      h: 0.5,
      fontSize: 16,
      fontFace: "Calibri",
      color: "666666",
    }
  );
  titleSlide.addText("Vygenerováno pomocí Brain", {
    x: 0.5,
    y: 4.8,
    w: 9,
    h: 0.3,
    fontSize: 10,
    fontFace: "Calibri",
    color: "999999",
  });

  // --- KPI Overview Slide ---
  const kpiSlide = pptx.addSlide();
  addHeader(kpiSlide, "Přehled výkonu");

  const coreMetrics = measures.slice(0, 4);
  const cardWidth = 2.1;
  const gap = 0.2;
  const startX =
    (10 - (coreMetrics.length * cardWidth + (coreMetrics.length - 1) * gap)) /
    2;

  coreMetrics.forEach((key, i) => {
    const x = startX + i * (cardWidth + gap);
    const value = totals[MEASURES[key]] || 0;
    const unit = getMeasureUnit(key);

    kpiSlide.addShape("roundRect", {
      x,
      y: 1.8,
      w: cardWidth,
      h: 1.8,
      fill: { color: LIGHT_BLUE },
      rectRadius: 0.1,
    });

    kpiSlide.addText(getMeasureLabel(key), {
      x,
      y: 1.9,
      w: cardWidth,
      h: 0.4,
      fontSize: 12,
      fontFace: "Calibri",
      color: "666666",
      align: "center",
    });

    kpiSlide.addText(formatNumber(value), {
      x,
      y: 2.3,
      w: cardWidth,
      h: 0.8,
      fontSize: 28,
      fontFace: "Calibri",
      color: NAVY,
      bold: true,
      align: "center",
    });

    if (unit) {
      kpiSlide.addText(unit, {
        x,
        y: 3.0,
        w: cardWidth,
        h: 0.3,
        fontSize: 11,
        fontFace: "Calibri",
        color: GREEN,
        align: "center",
      });
    }
  });

  // --- Monthly Trend Table ---
  if (buckets.length > 1) {
    const trendSlide = pptx.addSlide();
    addHeader(trendSlide, "Měsíční přehled");

    const tableRows: PptxGenJS.TableRow[] = [];

    // Header row
    const headerRow: PptxGenJS.TableCell[] = [
      {
        text: "Období",
        options: {
          bold: true,
          color: WHITE,
          fill: { color: NAVY },
          fontSize: 10,
          fontFace: "Calibri",
        },
      },
      ...measures.map((key) => ({
        text: getMeasureLabel(key),
        options: {
          bold: true,
          color: WHITE,
          fill: { color: NAVY },
          fontSize: 10,
          fontFace: "Calibri",
          align: "center" as const,
        },
      })),
    ];
    tableRows.push(headerRow);

    // Data rows
    buckets.forEach((bucket, idx) => {
      const measureMap: Record<string, number> = {};
      for (const m of bucket.overallMeasures) {
        measureMap[m.measure] = m.measuredValue;
      }

      const rowFill = idx % 2 === 1 ? LIGHT_BLUE : WHITE;
      const row: PptxGenJS.TableCell[] = [
        {
          text: formatDate(bucket.bucketStart),
          options: {
            fontSize: 9,
            fontFace: "Calibri",
            fill: { color: rowFill },
          },
        },
        ...measures.map((key) => ({
          text: formatNumber(measureMap[MEASURES[key]] || 0),
          options: {
            fontSize: 9,
            fontFace: "Calibri",
            align: "right" as const,
            fill: { color: rowFill },
          },
        })),
      ];
      tableRows.push(row);
    });

    trendSlide.addTable(tableRows, {
      x: 0.5,
      y: 1.4,
      w: 9,
      colW: [1.5, ...measures.map(() => (9 - 1.5) / measures.length)],
      border: { type: "solid", pt: 0.5, color: "CCCCCC" },
    });
  }

  // --- AI Analysis Slide ---
  if (analysis) {
    const analysisSlide = pptx.addSlide();
    addHeader(analysisSlide, "Analýza a doporučení");

    analysisSlide.addText(analysis, {
      x: 0.5,
      y: 1.4,
      w: 9,
      h: 3.8,
      fontSize: 11,
      fontFace: "Calibri",
      color: "333333",
      valign: "top",
      lineSpacingMultiple: 1.3,
    });

    analysisSlide.addText("Analýza vygenerována pomocí AI (Claude Sonnet)", {
      x: 0.5,
      y: 5.0,
      w: 9,
      h: 0.3,
      fontSize: 8,
      fontFace: "Calibri",
      color: "999999",
      italic: true,
    });
  }

  // --- Closing Slide ---
  const closingSlide = pptx.addSlide();
  closingSlide.addShape("rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: "100%",
    fill: { color: NAVY },
  });
  closingSlide.addText("alzaAds", {
    x: 0,
    y: 2.0,
    w: "100%",
    h: 1,
    fontSize: 40,
    fontFace: "Calibri",
    color: GREEN,
    bold: true,
    align: "center",
  });
  closingSlide.addText("Děkujeme za spolupráci", {
    x: 0,
    y: 3.2,
    w: "100%",
    h: 0.5,
    fontSize: 18,
    fontFace: "Calibri",
    color: WHITE,
    align: "center",
  });

  return pptx;
}

function addHeader(slide: PptxGenJS.Slide, title: string) {
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: "100%",
    h: 1.0,
    fill: { color: NAVY },
  });
  slide.addText("alzaAds", {
    x: 0.5,
    y: 0.15,
    w: 2,
    h: 0.5,
    fontSize: 16,
    fontFace: "Calibri",
    color: GREEN,
    bold: true,
  });
  slide.addText(title, {
    x: 3,
    y: 0.15,
    w: 6.5,
    h: 0.5,
    fontSize: 18,
    fontFace: "Calibri",
    color: WHITE,
    align: "right",
  });
}
