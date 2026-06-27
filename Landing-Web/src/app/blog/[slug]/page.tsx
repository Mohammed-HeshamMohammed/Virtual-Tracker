import { BlogPostView } from "@/features/blog/components/BlogPostView"

export default async function BlogPostPage({ params }: { params: Promise<{ slug?: string }> }) {
  let slug = ""

  try {
    const resolved = await params
    slug = typeof resolved.slug === "string" ? resolved.slug : ""
  } catch {
    slug = ""
  }

  return <BlogPostView slug={slug} />
}
