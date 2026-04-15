import ExcelJS from "exceljs";
import { ReportBucket, MeasureKey, MEASURES } from "@/lib/citrusad/types";

const NAVY = "00275B";
const LIGHT_BLUE = "ECF5FE";
const GREEN = "689700";

interface ExcelReportOptions {
  teamName: string;
  dateFrom: string;
  dateTo: string;
  buckets: ReportBucket[];
  measures: MeasureKey[];
  analysis?: string;
}

function formatCzechNumber(value: number, decimals = 2): string {
  return value
    .toFixed(decimals)
    .replace(".", ",")
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate().toString().padStart(2, "0")}.${(d.getMonth() + 1).toString().padStart(2, "0")}.${d.getFullYear()}`;
}

function getMeasureLabel(key: MeasureKey): string {
  const labels: Record<MeasureKey, string> = {
    Impressions: "Imprese",
    Clicks: "Kliky",
    Spend: "Náklady (CZK)",
    ROAS: "ROAS",
    CTR: "CTR (%)",
    CPC: "CPC (CZK)",
    CPM: "CPM (CZK)",
    Revenue: "Tržby (CZK)",
    Conversions: "Konverze",
    ConversionRate: "Míra konverze (%)",
    CPA: "CPA (CZK)",
    AvgPosition: "Prům. pozice",
    ActiveProducts: "Aktivní produkty",
    AdRevenue: "Příjmy z reklam (CZK)",
    RevenuePerClick: "Tržby na klik (CZK)",
  };
  return labels[key] || key;
}

export async function generateExcelReport(
  options: ExcelReportOptions
): Promise<Buffer> {
  const { teamName, dateFrom, dateTo, buckets, measures, analysis } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Brain";
  workbook.created = new Date();

  // Summary sheet
  const summary = workbook.addWorksheet("Souhrn");

  // Title
  summary.mergeCells("A1:F1");
  const titleCell = summary.getCell("A1");
  titleCell.value = `AlzaAds Report: ${teamName}`;
  titleCell.font = { size: 16, bold: true, color: { argb: "FF" + NAVY } };
  titleCell.alignment = { horizontal: "left" };

  summary.mergeCells("A2:F2");
  summary.getCell("A2").value = `Období: ${formatDate(dateFrom)} - ${formatDate(dateTo)}`;
  summary.getCell("A2").font = { size: 11, color: { argb: "FF666666" } };

  // KPI summary (totals across all buckets)
  const totals: Record<string, number> = {};
  for (const bucket of buckets) {
    for (const m of bucket.overallMeasures) {
      totals[m.measure] = (totals[m.measure] || 0) + m.measuredValue;
    }
  }

  let row = 4;
  summary.getCell(`A${row}`).value = "Metrika";
  summary.getCell(`B${row}`).value = "Hodnota";

  const headerRow = summary.getRow(row);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF" + NAVY },
    };
    cell.alignment = { horizontal: "center" };
  });

  row++;
  for (const key of measures) {
    const measureName = MEASURES[key];
    const value = totals[measureName] || 0;
    const isAlternate = (row - 5) % 2 === 1;

    summary.getCell(`A${row}`).value = getMeasureLabel(key);
    summary.getCell(`B${row}`).value = formatCzechNumber(value);
    summary.getCell(`B${row}`).alignment = { horizontal: "right" };

    if (isAlternate) {
      summary.getRow(row).eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FF" + LIGHT_BLUE },
        };
      });
    }
    row++;
  }

  summary.getColumn(1).width = 25;
  summary.getColumn(2).width = 20;

  // Monthly data sheet
  if (buckets.length > 1) {
    const monthly = workbook.addWorksheet("Měsíční data");

    monthly.getCell("A1").value = "Období";
    monthly.getCell("A1").font = {
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    monthly.getCell("A1").fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF" + NAVY },
    };

    measures.forEach((key, i) => {
      const col = String.fromCharCode(66 + i);
      const cell = monthly.getCell(`${col}1`);
      cell.value = getMeasureLabel(key);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF" + NAVY },
      };
      cell.alignment = { horizontal: "center" };
    });

    buckets.forEach((bucket, rowIdx) => {
      const r = rowIdx + 2;
      monthly.getCell(`A${r}`).value = formatDate(bucket.bucketStart);

      const measureMap: Record<string, number> = {};
      for (const m of bucket.overallMeasures) {
        measureMap[m.measure] = m.measuredValue;
      }

      measures.forEach((key, i) => {
        const col = String.fromCharCode(66 + i);
        const value = measureMap[MEASURES[key]] || 0;
        monthly.getCell(`${col}${r}`).value = formatCzechNumber(value);
        monthly.getCell(`${col}${r}`).alignment = { horizontal: "right" };
      });

      if (rowIdx % 2 === 1) {
        monthly.getRow(r).eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF" + LIGHT_BLUE },
          };
        });
      }
    });

    monthly.getColumn(1).width = 15;
    for (let i = 0; i < measures.length; i++) {
      monthly.getColumn(i + 2).width = 18;
    }
  }

  // AI Analysis sheet
  if (analysis) {
    const analysisSheet = workbook.addWorksheet("Analýza");
    analysisSheet.mergeCells("A1:F1");
    analysisSheet.getCell("A1").value = "AI Analýza";
    analysisSheet.getCell("A1").font = {
      size: 14,
      bold: true,
      color: { argb: "FF" + GREEN },
    };

    analysisSheet.mergeCells("A3:F30");
    const analysisCell = analysisSheet.getCell("A3");
    analysisCell.value = analysis;
    analysisCell.alignment = { wrapText: true, vertical: "top" };
    analysisSheet.getColumn(1).width = 100;
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function generateCsvReport(
  options: ExcelReportOptions
): string {
  const { teamName, dateFrom, dateTo, buckets, measures } = options;
  const BOM = "\uFEFF";
  const lines: string[] = [];

  lines.push(`AlzaAds Report: ${teamName}`);
  lines.push(`Období: ${formatDate(dateFrom)} - ${formatDate(dateTo)}`);
  lines.push("");

  // Header
  const header = ["Období", ...measures.map(getMeasureLabel)];
  lines.push(header.join(";"));

  // Data rows
  for (const bucket of buckets) {
    const measureMap: Record<string, number> = {};
    for (const m of bucket.overallMeasures) {
      measureMap[m.measure] = m.measuredValue;
    }
    const values = measures.map((key) =>
      formatCzechNumber(measureMap[MEASURES[key]] || 0)
    );
    lines.push([formatDate(bucket.bucketStart), ...values].join(";"));
  }

  return BOM + lines.join("\r\n");
}
