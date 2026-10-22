import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, MapPin, MessageCircle, Send, UsersRound } from "lucide-react";
import { SiteFrame } from "@/components/site-frame";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/lib/site-config";
import { pageHead } from "@/lib/metadata";

export const Route = createFileRoute("/contact")({
  head: () =>
    pageHead("Contact", "Contact BESTPLUG MARKETPLACE on WhatsApp or Telegram. Based in Lagos."),
  component: ContactPage,
});

const contactMethods = [
  {
    label: "WhatsApp Community",
    buttonLabel: "Join WhatsApp Community",
    href: siteConfig.contacts.whatsappCommunity,
    icon: UsersRound,
  },
  {
    label: "Telegram Contact",
    buttonLabel: "Contact Us on Telegram",
    href: siteConfig.contacts.telegram,
    icon: Send,
  },
  {
    label: "WhatsApp Direct Contact",
    buttonLabel: "Chat on WhatsApp",
    href: siteConfig.contacts.whatsappDirect,
    icon: MessageCircle,
  },
] as const;

function ContactPage() {
  return (
    <SiteFrame>
      <main className="mx-auto min-h-[65vh] max-w-7xl px-5 py-10 sm:px-8">
        <p className="text-xs font-semibold uppercase text-primary">BESTPLUG MARKETPLACE</p>
        <h1 className="section-heading mt-2">Contact</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          Connect with our community or reach the team directly.
        </p>
        <section
          aria-label="Contact options"
          className="mt-8 grid border-y border-border sm:grid-cols-2"
        >
          {contactMethods.map(({ label, buttonLabel, href, icon: Icon }) => (
            <article
              key={label}
              className="flex min-h-48 flex-col items-start border-b border-border p-5 sm:even:border-l sm:odd:border-r"
            >
              <Icon aria-hidden="true" className="size-5 text-primary" />
              <h2 className="mt-4 text-base font-semibold">{label}</h2>
              <Button asChild className="mt-5">
                <a href={href} target="_blank" rel="noopener noreferrer">
                  {buttonLabel}
                  <ArrowUpRight aria-hidden="true" />
                </a>
              </Button>
              <a
                className="mt-3 block break-all text-xs text-muted-foreground underline underline-offset-4"
                href={href}
                target="_blank"
                rel="noopener noreferrer"
              >
                {href}
              </a>
            </article>
          ))}
          <article className="min-h-48 p-5 sm:border-l sm:border-border">
            <MapPin aria-hidden="true" className="size-5 text-primary" />
            <h2 className="mt-4 text-base font-semibold">Location</h2>
            <p className="mt-2 text-sm text-muted-foreground">{siteConfig.contacts.location}</p>
          </article>
        </section>
      </main>
    </SiteFrame>
  );
}
