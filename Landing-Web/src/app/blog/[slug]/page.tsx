import { BlogPostView } from "@/features/blog/components/BlogPostView"
import { BLOG_POSTS } from "@/lib/product-content"

export function generateStaticParams() {
  return BLOG_POSTS.map((post) => ({ slug: post.slug }))
}

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
