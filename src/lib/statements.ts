import type { ContestPackage, TaskStatement } from "./types";
/** Presentation cleanup only: preserve the source files and dataset splits. */
export function taskStatements(pkg: ContestPackage): TaskStatement[] {
  if (pkg.tasks?.length) return pkg.tasks;
  const source = pkg.statement
    .split(/^# Nguồn tham khảo và phạm vi suy luận/m)[0]
    .replaceAll("<!-- PAGE -->", "");
  const first = source.indexOf("# Tác vụ 1 "),
    second = source.indexOf("# Tác vụ 2 "),
    last = source.indexOf("# Nộp bài và tái tạo");
  const rules = `## Quy định nộp bài\n\nPublic và private được chấm ngay sau khi nộp hợp lệ. Mỗi tác vụ lấy điểm cao nhất của từng tập. Tổng điểm là tổng hai tác vụ, tối đa 200 điểm. Nếu bằng điểm, ưu tiên EM tác vụ 2, sau đó thời điểm đạt điểm sớm hơn.\n\nQuota và thời gian áp dụng theo cấu hình của vòng luyện. Nộp CSV UTF-8, đúng schema và đầy đủ ID. Mã nguồn, trọng số và báo cáo được gửi riêng cho quản trị viên.\n\n`;
  const commonStart = source.indexOf("## Mô hình và dữ liệu được phép"),
    commonEnd = source.indexOf("## Xếp hạng");
  const common =
    commonStart >= 0 && commonEnd > commonStart
      ? source.slice(commonStart, commonEnd)
      : "";
  return [
    {
      id: "1",
      title: "Tách từng nhân tế bào",
      content:
        rules +
        (first >= 0
          ? source.slice(first, second > first ? second : undefined)
          : source) +
        "\n" +
        common,
    },
    {
      id: "2",
      title: "Đọc hiểu và biết khi nào không có đáp án",
      content:
        rules +
        (second >= 0
          ? source.slice(second, last > second ? last : undefined)
          : source) +
        "\n" +
        common,
    },
  ];
}
