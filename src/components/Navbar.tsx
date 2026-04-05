"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/generate", label: "Generate" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="border-b border-neutral-800 bg-neutral-950">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        <span className="text-lg font-bold text-white">Nano Banana</span>
        <div className="flex gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                pathname === link.href
                  ? "bg-neutral-800 text-white"
                  : "text-neutral-400 hover:text-white"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
