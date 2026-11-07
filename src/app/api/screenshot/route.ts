import { renderBoardScreenshot } from "@/lib/whiteboard/screenshot";
import { listObjects } from "@/lib/whiteboard/services";

export const runtime = "nodejs";

export async function GET() {
  const { png } = renderBoardScreenshot(listObjects());
  return new Response(new Uint8Array(png), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}
