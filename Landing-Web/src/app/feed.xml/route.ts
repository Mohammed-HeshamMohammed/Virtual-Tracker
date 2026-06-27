import { NextResponse } from "next/server"

export async function GET() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Virtual Tracker Blog</title>
    <link>https://virtualtracker.com/blog</link>
    <description>Updates and insights from Virtual Tracker.</description>
    <item>
      <title>How modern teams are improving accountability with better time tracking</title>
      <link>https://virtualtracker.com/blog</link>
      <description>Learn how clear time tracking improves workflows, reporting, and team alignment.</description>
    </item>
  </channel>
</rss>`

  return new NextResponse(xml, {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  })
}
