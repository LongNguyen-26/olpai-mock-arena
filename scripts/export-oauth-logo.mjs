// Rasterize the existing editable Arena icon without changing its design.
import { mkdir,readFile } from "node:fs/promises";
import sharp from "sharp";
await mkdir("public/branding",{recursive:true});
const source=await readFile("src/app/icon.svg");
for(const size of [120,512]) {
  const path=`public/branding/olpai-arena-oauth-${size}.png`;
  await sharp(source).resize(size,size).png().toFile(path);
  console.log(path);
}
