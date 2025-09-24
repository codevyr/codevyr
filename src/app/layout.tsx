import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Codevyr',
  description: 'Source code analysis and visualization',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <Script
          defer
          data-domain="ui.codevyr.com"
          src="https://plausible.codevyr.com/js/script.js"
        />
      </head>
      <body className={inter.className}>
        {children}
      </body>
    </html>
  )
}
