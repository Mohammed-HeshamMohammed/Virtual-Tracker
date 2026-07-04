"use client"

import { useState } from "react"
import PageShell from "../../components/PageShell"
import PageIntro from "@/components/PageIntro"
import { submitContactInquiry } from "@/lib/contact-api"

export default function ContactPage() {
  const [submitted, setSubmitted] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [selectedTopic, setSelectedTopic] = useState("trial")
  const [formData, setFormData] = useState({ name: "", email: "", size: "1-10", message: "" })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData.name || !formData.email || submitting) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      await submitContactInquiry({
        name: formData.name,
        email: formData.email,
        topic: selectedTopic,
        teamSize: formData.size,
        message: formData.message,
      })
      setSubmitted(true)
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit your message. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  const topics = [
    { id: "trial", label: "Local Trial" },
    { id: "cloud", label: "Custom Cloud" },
    { id: "security", label: "Security & Rules" },
    { id: "general", label: "General" }
  ]

  return (
    <PageShell>
      <main className="bg-slate-50/50 text-slate-900 pb-24">
        <PageIntro
          eyebrow="Contact Us"
          title="Talk to a product specialist"
          description="Let us know what you want to achieve with Virtual Tracker and we will help you map out a trial deployment roadmap."
        />

        <section className="mx-auto max-w-7xl px-6 lg:px-8 mt-16 grid gap-12 lg:grid-cols-[1.2fr_0.8fr]">
          {/* Contact Form */}
          <div className="rounded-3xl border border-slate-200 bg-white p-8 md:p-10 shadow-sm">
            {submitted ? (
              <div className="h-full flex flex-col items-center justify-center text-center py-12 space-y-4">
                <div className="w-16 h-16 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600 animate-bounce">
                  <svg viewBox="0 0 24 24" className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-slate-900">Message sent successfully!</h3>
                <p className="text-xs text-slate-500 max-w-xs mx-auto font-light">
                  Thank you for reaching out, {formData.name}. Our team will review your inquiry for the <span className="font-bold text-violet-700">{topics.find(t => t.id === selectedTopic)?.label}</span> setup.
                </p>
                <button
                  onClick={() => { setSubmitted(false); setFormData({ name: "", email: "", size: "1-10", message: "" }) }}
                  className="mt-4 text-xs font-semibold text-violet-600 hover:text-violet-800 transition-colors"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div className="space-y-3">
                  <h3 className="text-lg font-bold text-slate-900">Inquire about a deployment</h3>
                  
                  {/* Topic Selector Chips */}
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Topic of Interest</label>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {topics.map((topic) => (
                        <button
                          key={topic.id}
                          type="button"
                          onClick={() => setSelectedTopic(topic.id)}
                          className={`px-4 py-2 rounded-xl text-xs font-bold border transition-all duration-200 cursor-pointer ${
                            selectedTopic === topic.id
                              ? "bg-violet-600 border-violet-600 text-white shadow-sm"
                              : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-800"
                          }`}
                        >
                          {topic.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Full Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g. John Doe"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Work Email</label>
                    <input
                      type="email"
                      required
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="e.g. john@yourcompany.com"
                      className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Estimated Team Size</label>
                  <select
                    value={formData.size}
                    onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none bg-white transition-all duration-200"
                  >
                    <option value="1-10">1-10 members</option>
                    <option value="11-50">11-50 members</option>
                    <option value="51-200">51-200 members</option>
                    <option value="200+">200+ members</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">Message</label>
                  <textarea
                    rows={4}
                    required
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    placeholder="Tell us about your team setup and tracking goals..."
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-violet-500 focus:ring-1 focus:ring-violet-200 focus:outline-none transition-all duration-200 bg-slate-50/50 hover:bg-slate-50 resize-none"
                  />
                </div>

                {submitError && (
                  <p className="text-xs font-semibold text-red-600" role="alert">
                    {submitError}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-full bg-violet-600 px-6 py-3.5 text-xs font-bold text-white hover:bg-violet-700 shadow-md hover:shadow-lg transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? "Sending..." : "Send Inquiry"}
                </button>
              </form>
            )}
          </div>

          {/* Quick Help Channels */}
          <div className="space-y-6">
            <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <h3 className="text-lg font-bold text-slate-900 mb-4">Book a Walkthrough</h3>
              <p className="text-xs leading-relaxed text-slate-500 font-light mb-6">
                We'll walk you through how Virtual Tracker organizes team hierarchy, runs the desktop screenshot agent, and handles Firebase database scopes.
              </p>
              <div className="space-y-4">
                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 flex gap-3.5 items-start">
                  <div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-700 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Firebase Onboarding</h4>
                    <p className="text-[11px] text-slate-400 font-light mt-0.5">Use email verification and Google sign-in methods mapped natively inside Firestore.</p>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-100 bg-slate-50 p-4 flex gap-3.5 items-start">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-800">Support Slack & Channels</h4>
                    <p className="text-[11px] text-slate-400 font-light mt-0.5">Reach out via your team's designated deployment channels for backend setup questions.</p>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-slate-200 bg-violet-600 p-8 text-white shadow-md relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-violet-500 rounded-full blur-2xl" />
              <h3 className="text-base font-bold mb-2">Evaluate on your local machine</h3>
              <p className="text-xs text-white/75 font-light leading-relaxed mb-4">
                You can run the full environment locally. Clone the repository, setup Firestore credentials, and start the app launcher.
              </p>
              <a href="/demo" className="text-xs font-bold underline hover:text-white/95">
                Go to trial setup checklist &rarr;
              </a>
            </div>
          </div>
        </section>
      </main>
    </PageShell>
  )
}
