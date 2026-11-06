const coverThemes: [RegExp, string][] = [
  [/thú cưng/i, "pets"],
  [/nhà hàng/i, "restaurant"],
  [/phụ tải điện/i, "power"],
  [/nhiều cảm xúc/i, "emotions"],
  [/tế bào/i, "cells"],
  [/đọc hiểu/i, "reading"],
  [/đồ ăn/i, "delivery"],
  [/khách hàng/i, "reviews"],
  [/máy bơm/i, "pump"],
  [/hành khách/i, "transit"],
  [/bến kênh/i, "canal"],
];

export function coverFor(title: string) {
  return coverThemes.find(([pattern]) => pattern.test(title))?.[1] ?? "neutral";
}
