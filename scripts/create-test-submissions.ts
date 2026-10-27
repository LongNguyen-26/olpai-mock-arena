import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { judgeCV, judgeQA } from "../src/lib/judge";
import type { CVImage, QAItem } from "../src/lib/types";
const out = ".local/test-submissions";
const quote = (s: string) =>
  /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
async function main() {
  const scores = [];
  for (const split of ["public", "private"] as const)
    for (const task of ["1", "2"] as const) {
      const folder = `${out}/${split}/Tac_vu_${task}`;
      await mkdir(folder, { recursive: true });
      const truth = JSON.parse(
        gunzipSync(
          await readFile(
            `.local/judges/${task === "1" ? "cv" : "qa"}-${split}.json.gz`,
          ),
        ).toString("utf8"),
      ) as CVImage[] | QAItem[];
      let low: string, high: string;
      if (task === "1") {
        low =
          "ImageId,EncodedPixels\n" +
          (truth as CVImage[]).map((x) => x.id + ",").join("\n") +
          "\n";
        high =
          "ImageId,EncodedPixels\n" +
          (truth as CVImage[])
            .flatMap((x) =>
              x.masks.length
                ? x.masks.map(
                    (mask) =>
                      x.id +
                      "," +
                      mask
                        .flatMap((n, i) =>
                          i % 2 === 0 ? [n + 1, mask[i + 1] - n] : [],
                        )
                        .join(" "),
                  )
                : [x.id + ","],
            )
            .join("\n") +
          "\n";
      } else {
        low =
          "id,prediction\n" +
          (truth as QAItem[])
            .map(
              (x) =>
                x.id +
                "," +
                quote(x.is_impossible ? x.context.slice(0, 1) : ""),
            )
            .join("\n") +
          "\n";
        high =
          "id,prediction\n" +
          (truth as QAItem[])
            .map((x) => x.id + "," + quote(x.answers[0]?.text ?? ""))
            .join("\n") +
          "\n";
      }
      await writeFile(
        `${folder}/01-khong-hop-le.csv`,
        task === "1"
          ? "ImageId,EncodedPixels\nid_khong_ton_tai,0 99999999\n"
          : "id,prediction\nid_khong_ton_tai,not a valid span\n",
      );
      await writeFile(`${folder}/02-hop-le-diem-thap.csv`, low);
      await writeFile(`${folder}/03-hop-le-diem-cao.csv`, high);
      if (split === "public")
        await copyFile(
          `../statements/contestant/Tac_vu_${task}/submission.csv`,
          `${folder}/00-nop-thu.csv`,
        );
      else await writeFile(`${folder}/00-nop-thu.csv`, low);
      const evaluate = (csv: string) =>
        task === "1"
          ? judgeCV(csv, truth as CVImage[])
          : judgeQA(csv, truth as QAItem[]);
      const base = evaluate(await readFile(`${folder}/00-nop-thu.csv`, "utf8"));
      const weak = evaluate(low),
        strong = evaluate(high);
      scores.push({
        split,
        task,
        test: base.score,
        low: weak.score,
        high: strong.score,
      });
    }
  await writeFile(
    `${out}/KET_QUA_KIEM_TRA.json`,
    JSON.stringify(scores, null, 2),
  );
  await writeFile(
    `${out}/CHI_DAN_ADMIN.md`,
    "# CSV kiểm tra chức năng dành riêng cho admin\n\nKhông phát thư mục này cho thí sinh và không dùng các CSV này để báo cáo chất lượng mô hình. File điểm cao được tạo từ đáp án giữ kín nhằm kiểm tra hệ thống; không phải dự đoán mô hình. Mỗi tập public/private có 4 file cho từng tác vụ: 00 để thử, 01 lỗi, 02 điểm thấp, 03 điểm cao. File 00 public là CSV baseline hiện có; file 00 private dùng mẫu đơn giản. Số điểm thực tế ở KET_QUA_KIEM_TRA.json.\n",
  );
  console.log(JSON.stringify(scores));
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
