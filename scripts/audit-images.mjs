import fs from "fs";
import path from "path";

const root = process.cwd();
const scanExts = new Set([".html", ".css", ".scss", ".js"]);
const skipDirs = new Set(["node_modules", ".git"]);

const files = [];
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory()) {
      if (skipDirs.has(ent.name)) continue;
      walk(path.join(dir, ent.name));
      continue;
    }
    if (scanExts.has(path.extname(ent.name))) files.push(path.join(dir, ent.name));
  }
}
walk(root);

const imgRefRe = /(?:src|href)=["']([^"']*img\/[^"]+?\.(?:png|jpg|jpeg|webp|gif|svg|ico))(?:["'])|url\((["']?)([^)"']*img\/[^)"']+?\.(?:png|jpg|jpeg|webp|gif|svg|ico))\2\)/gi;

let totalRefs = 0;
const missing = [];

for (const f of files) {
  const txt = fs.readFileSync(f, "utf8");
  let m;
  while ((m = imgRefRe.exec(txt))) {
    const ref = m[1] || m[3];
    if (!ref) continue;
    totalRefs++;

    if (/^https?:\/\//i.test(ref) || ref.startsWith("data:")) continue;

    const noQuery = ref.split("?")[0].split("#")[0];
    let resolved;
    if (noQuery.startsWith("/")) resolved = path.join(root, noQuery.slice(1));
    else resolved = path.resolve(path.dirname(f), noQuery);

    if (!fs.existsSync(resolved)) {
      missing.push({ file: path.relative(root, f), ref: noQuery.replace(/\\/g, "/") });
    }
  }
}

const uniq = Array.from(new Map(missing.map(it => [`${it.file}|${it.ref}`, it])).values());
console.log(`STATIC_IMG_REFS=${totalRefs}`);
console.log(`STATIC_IMG_MISSING=${uniq.length}`);
for (const it of uniq.slice(0, 200)) console.log(`MISS ${it.file} :: ${it.ref}`);
