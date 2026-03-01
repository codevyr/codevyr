import 'reactflow/dist/style.css'
import './globals.css'
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import AnalyticsScript from './components/AnalyticsScript'

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
        <Script src="/runtime-env.js" strategy="beforeInteractive" />
      </head>
      <body className={inter.className}>
        <AnalyticsScript />
        {children}
      </body>
    </html>
  )
}
