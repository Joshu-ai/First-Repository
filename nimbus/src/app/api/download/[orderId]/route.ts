import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { FILES_DIR, q } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Log in first" }, { status: 401 });
  const order = q.orderById(Number((await params).orderId));
  if (!order || order.status !== "paid" || (order.user_id !== user.id && !user.is_admin)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const product = q.productById(order.product_id);
  if (!product?.file_name) return NextResponse.json({ error: "This product's file hasn't been uploaded yet." }, { status: 404 });
  const file = path.join(FILES_DIR, path.basename(product.file_name));
  if (!fs.existsSync(file)) return NextResponse.json({ error: "File missing on server." }, { status: 404 });
  const stream = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
  return new NextResponse(stream, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${path.basename(product.file_name)}"`,
      "content-length": String(fs.statSync(file).size),
      "cache-control": "private, no-store",
    },
  });
}
