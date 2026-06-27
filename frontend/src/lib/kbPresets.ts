/**
 * Knowledge-base quick-add presets.
 *
 * A curated library of starter chunks that admins can drop into their
 * knowledge base in one click. Each preset pre-fills the title and
 * scaffolds the content with prompts the operator fills in (or saves
 * as-is as a draft).
 *
 * Presets are frontend-only — they don't live in the database. Drafts
 * saved from a preset become regular KB chunks (source_type='manual')
 * and can be edited, deleted, or re-used like any other chunk.
 *
 * To add a preset: drop a new entry into KB_PRESETS. Pick an icon
 * from lucide-react (used by reference name in `icon`).
 */

export type KBPresetCategoryId =
  | 'customer_service'
  | 'billing'
  | 'product'
  | 'policy'
  | 'custom'

export interface KBPresetCategory {
  id: KBPresetCategoryId | 'all'
  label: string
  /** lucide-react icon name (used dynamically) */
  icon: string
  /** Tailwind classes for the icon block background + text */
  accent: string
}

export interface KBPreset {
  id: number
  category: KBPresetCategoryId
  /** lucide-react icon name */
  icon: string
  title: string
  description: string
  /** Multi-line scaffold that becomes the initial content when the
   *  user picks "Use template" or clicks "Save as draft". */
  placeholder: string
}

/* ---------------- Categories ---------------- */

export const KB_PRESET_CATEGORIES: KBPresetCategory[] = [
  { id: 'all',              label: 'All',              icon: 'Sparkles',   accent: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300' },
  { id: 'customer_service', label: 'Customer service', icon: 'Headphones',  accent: 'bg-sky-50 dark:bg-sky-500/15 text-sky-700 dark:text-sky-300' },
  { id: 'billing',          label: 'Billing',          icon: 'Receipt',     accent: 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  { id: 'product',          label: 'Product',          icon: 'Package',     accent: 'bg-violet-50 dark:bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  { id: 'policy',           label: 'Policy',           icon: 'ShieldCheck', accent: 'bg-amber-50 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300' },
  { id: 'custom',           label: 'Custom',           icon: 'Plus',        accent: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300' },
]

/* ---------------- Presets ---------------- */

export const KB_PRESETS: KBPreset[] = [
  /* ---------------- Customer service ---------------- */
  {
    id: 1,
    category: 'customer_service',
    icon: 'RefreshCw',
    title: 'Refund policy',
    description: 'Refund window, eligibility, and how to start a return.',
    placeholder:
      `Refund window: __ days from delivery.\n` +
      `Eligibility: items must be unused, in original packaging, with tags attached.\n` +
      `Non-refundable: sale items, digital products, perishable goods.\n` +
      `How to start: customer messages "refund {order-id}" on WhatsApp — we share a return form within 1 working day.\n` +
      `Refund method: original payment method, processed in __ business days after we receive the item.`,
  },
  {
    id: 2,
    category: 'customer_service',
    icon: 'RotateCcw',
    title: 'Return & exchange',
    description: 'What is returnable, exchange window, condition requirements.',
    placeholder:
      `Returnable: most items within __ days of delivery.\n` +
      `Exchange: free size / colour exchange within __ days if stock allows.\n` +
      `Condition: unused, original packaging, all tags and accessories included.\n` +
      `Process: customer shares a photo of the item + order ID; we approve or decline within 1 working day.\n` +
      `Shipping: customer drops off at the nearest courier partner, or we arrange pickup (₹__ fee).`,
  },
  {
    id: 3,
    category: 'customer_service',
    icon: 'Truck',
    title: 'Shipping & delivery',
    description: 'Delivery time, regions served, courier partners, tracking.',
    placeholder:
      `Regions served: pan-India (urban: __ days, rural: __ days).\n` +
      `Courier partners: __, __, __.\n` +
      `Free shipping: orders above ₹__ ; otherwise ₹__ flat.\n` +
      `Tracking: a tracking link is sent on WhatsApp within 24 hours of dispatch.\n` +
      `Delays: if no movement for __ days, contact us and we will follow up with the courier.`,
  },
  {
    id: 4,
    category: 'customer_service',
    icon: 'Clock',
    title: 'Store hours',
    description: 'Opening hours, holiday closures, timezone.',
    placeholder:
      `WhatsApp support: Monday to Saturday, 9:00 AM – 7:00 PM IST.\n` +
      `Store visits: Monday to Saturday, 10:00 AM – 8:00 PM IST. Closed on Sundays and public holidays.\n` +
      `After-hours: messages received after 7 PM are replied to by 10 AM the next working day.\n` +
      `Public holidays 2026: __, __, __.`,
  },
  {
    id: 5,
    category: 'customer_service',
    icon: 'Phone',
    title: 'Contact info',
    description: 'Phone, email, WhatsApp, support hours, escalation.',
    placeholder:
      `WhatsApp: this number.\n` +
      `Phone: +91-__-__-__-__.\n` +
      `Email: support@__.\n` +
      `Support hours: Monday to Saturday, 9:00 AM – 7:00 PM IST.\n` +
      `Escalation: if unresolved after __ hours, share a summary and we will assign a senior agent.`,
  },
  {
    id: 6,
    category: 'customer_service',
    icon: 'MapPin',
    title: 'Order tracking',
    description: 'How to track an order, expected delivery dates.',
    placeholder:
      `How to track: we send a tracking link on WhatsApp within 24 hours of dispatch. Tap the link to see live status.\n` +
      `Expected delivery: __ days from dispatch for your pincode.\n` +
      `Status updates: confirmed → packed → shipped → out for delivery → delivered.\n` +
      `If the tracking link does not open, reply "refresh" and we will resend it.`,
  },

  /* ---------------- Billing ---------------- */
  {
    id: 7,
    category: 'billing',
    icon: 'Receipt',
    title: 'Overdue reminder',
    description: 'Polite overdue-payment reminder with payment link.',
    placeholder:
      `Hi {retailer_name}, this is a friendly reminder that invoice {invoice_number} for ₹{amount} was due on {due_date}.\n` +
      `Pay here: {payment_link}\n` +
      `If you have already paid, please ignore this message and reply with the UTR / reference number.\n` +
      `Need help? Reply "help" and we will get back to you within 1 working day.`,
  },
  {
    id: 8,
    category: 'billing',
    icon: 'CreditCard',
    title: 'Payment methods',
    description: 'Accepted payment methods, UPI IDs, bank transfer details.',
    placeholder:
      `We accept:\n` +
      `• UPI — ID: __@__ (preferred, instant)\n` +
      `• Bank transfer — Account name __, A/C __, IFSC __\n` +
      `• Cheque — payable to "__", post-dated cheques accepted for orders above ₹__\n` +
      `After paying, please share the UTR / transaction ID on this WhatsApp number so we can mark your invoice as paid.`,
  },
  {
    id: 9,
    category: 'billing',
    icon: 'CalendarClock',
    title: 'Due date notification',
    description: 'Friendly due-date reminder sent a few days before.',
    placeholder:
      `Hi {retailer_name}, a quick reminder that invoice {invoice_number} for ₹{amount} is due in __ days ({due_date}).\n` +
      `Pay anytime before the due date here: {payment_link}\n` +
      `Paying early helps you avoid late fees and keeps your account in good standing.\n` +
      `Questions? Reply to this message — we are happy to help.`,
  },
  {
    id: 10,
    category: 'billing',
    icon: 'BadgeCheck',
    title: 'Payment confirmation',
    description: 'Thank-you message after payment is received.',
    placeholder:
      `Hi {retailer_name}, we have received your payment of ₹{amount} for invoice {invoice_number}. Thank you!\n` +
      `Receipt / acknowledgement: {payment_link}\n` +
      `Your account is now up to date. Your next invoice is scheduled for __.\n` +
      `Thank you for your business.`,
  },
  {
    id: 11,
    category: 'billing',
    icon: 'AlertCircle',
    title: 'Late fee policy',
    description: 'Late fee percentage, grace period, waiver policy.',
    placeholder:
      `Late fee: __% per __ on overdue invoices.\n` +
      `Grace period: __ days from the due date.\n` +
      `Waivers: late fees are automatically waived the first time a customer pays late; subsequent late fees are reviewed case-by-case.\n` +
      `To request a waiver: reply with invoice number + reason — we respond within 1 working day.`,
  },
  {
    id: 12,
    category: 'billing',
    icon: 'FileText',
    title: 'Receipt template',
    description: 'Auto-generated receipt format.',
    placeholder:
      `Receipt\n` +
      `------\n` +
      `Invoice: {invoice_number}\n` +
      `Date: {payment_date}\n` +
      `Retailer: {retailer_name}\n` +
      `Amount: ₹{amount}\n` +
      `Method: UPI / Bank transfer / Cheque\n` +
      `Reference: {utr}\n` +
      `Status: Paid in full. Thank you.`,
  },

  /* ---------------- Product / catalog ---------------- */
  {
    id: 13,
    category: 'product',
    icon: 'Package',
    title: 'Product catalog overview',
    description: 'Categories you sell, top brands, how to browse.',
    placeholder:
      `We carry __ categories: __, __, __, __, __.\n` +
      `Top brands: __, __, __.\n` +
      `How to browse: share a category, brand, or item name on WhatsApp and we will send you the latest catalog with prices and stock.\n` +
      `Bulk orders: share your requirements (item + quantity + pincode) and we will quote within 1 working day.`,
  },
  {
    id: 14,
    category: 'product',
    icon: 'Tag',
    title: 'Pricing & discounts',
    description: 'MSRP, bulk discounts, active promotions.',
    placeholder:
      `MRP is printed on every item. Our wholesale prices vary by SKU and order size.\n` +
      `Bulk discount tiers:\n` +
      `• 10+ units: __% off\n` +
      `• 50+ units: __% off\n` +
      `• 100+ units: __% off\n` +
      `Current promotions (this month): __, __, __ — ask for details on WhatsApp.`,
  },
  {
    id: 15,
    category: 'product',
    icon: 'Boxes',
    title: 'Stock & availability',
    description: 'In-stock policy, backorder ETA, restock notifications.',
    placeholder:
      `Stock is updated in real time. If the product page / WhatsApp reply says "in stock", it is ready to dispatch within 24 hours.\n` +
      `Backorders: if an item is out of stock, you can reserve a unit — expected restock in __ days. We will WhatsApp you the moment it arrives.\n` +
      `Low-stock alerts: reply "alert {sku}" to be notified when an out-of-stock item is back.`,
  },
  {
    id: 16,
    category: 'product',
    icon: 'ShieldCheck',
    title: 'Warranty terms',
    description: 'Warranty period, what is covered, claim process.',
    placeholder:
      `Warranty period: __ months from delivery date (manufacturer defects only).\n` +
      `Covered: manufacturing defects, motor / electronic failure under normal use.\n` +
      `Not covered: physical damage, water damage, unauthorised repair, normal wear and tear.\n` +
      `How to claim: WhatsApp a short video showing the issue + order ID. We will authorise a replacement or repair within __ working days.`,
  },
  {
    id: 17,
    category: 'product',
    icon: 'HelpCircle',
    title: 'Product FAQ',
    description: 'Most-asked product questions and short answers.',
    placeholder:
      `Q: Are these genuine / original?\n` +
      `A: Yes — every product is sourced directly from the brand or its authorised distributor. We include a manufacturer warranty card with every order.\n` +
      `\n` +
      `Q: Do you ship to my pincode?\n` +
      `A: We ship pan-India. Share your pincode on WhatsApp and we will confirm delivery time.\n` +
      `\n` +
      `Q: Can I change my order after placing it?\n` +
      `A: Yes, within 2 hours of placing the order. Reply to your order confirmation message with the change you need.`,
  },

  /* ---------------- Policy ---------------- */
  {
    id: 18,
    category: 'policy',
    icon: 'Lock',
    title: 'Privacy policy summary',
    description: 'How customer data is collected, used, stored.',
    placeholder:
      `What we collect: name, phone number, address (for delivery), order history.\n` +
      `What we do NOT collect: Aadhaar, PAN (unless required for invoicing above ₹__), payment card details.\n` +
      `How we use it: order fulfilment, support, fraud prevention, optional marketing (you can opt out anytime by replying "STOP").\n` +
      `How long we keep it: __ years after your last order, after which it is deleted.\n` +
      `Your rights: request a copy, correct, or delete your data by emailing privacy@__.`,
  },
  {
    id: 19,
    category: 'policy',
    icon: 'ScrollText',
    title: 'Terms of service',
    description: 'Acceptable use, account terms, governing law.',
    placeholder:
      `By placing an order, you agree to:\n` +
      `• Provide accurate delivery details.\n` +
      `• Pay the invoice amount by the due date.\n` +
      `• Use our WhatsApp support for legitimate order / product questions only.\n` +
      `We reserve the right to refuse service in cases of fraud, abuse, or repeated non-payment.\n` +
      `Governing law: courts of [your city], India.`,
  },
  {
    id: 20,
    category: 'policy',
    icon: 'MessageSquareWarning',
    title: 'Complaints & escalation',
    description: 'How to file a complaint, expected response time, escalation.',
    placeholder:
      `How to file a complaint: send a WhatsApp message starting with "complaint" followed by a short description. We will create a ticket immediately.\n` +
      `Response time: first reply within 1 working day; resolution within __ working days.\n` +
      `If you are not satisfied: reply "escalate" — your ticket is forwarded to a senior manager within 24 hours.\n` +
      `If still unresolved: contact our Grievance Officer (details in next preset).`,
  },
  {
    id: 21,
    category: 'policy',
    icon: 'UserCheck',
    title: 'Grievance officer',
    description: 'Name + contact of grievance officer (required for India DPDP).',
    placeholder:
      `Grievance Officer\n` +
      `Name: __\n` +
      `Email: grievance@__\n` +
      `Phone: +91-__-__-__-__\n` +
      `Response time: within 48 hours of receiving a complaint.\n` +
      `This contact is published in line with the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 and the Digital Personal Data Protection Act, 2023.`,
  },
  {
    id: 22,
    category: 'policy',
    icon: 'XCircle',
    title: 'Cancellation policy',
    description: 'Cancellation window, refund percentage, how to cancel.',
    placeholder:
      `Cancellation window: full refund if cancelled within __ hours of placing the order and before dispatch.\n` +
      `After dispatch: order can be refused at delivery for a __% refund (delivery charges non-refundable).\n` +
      `Custom / made-to-order items: non-cancellable once production has started.\n` +
      `How to cancel: reply to your order confirmation message with "cancel" — we will confirm within 1 working day.`,
  },

  /* ---------------- Custom ---------------- */
  {
    id: 23,
    category: 'custom',
    icon: 'Plus',
    title: 'Custom chunk',
    description: 'Start from scratch with the blank Add modal.',
    placeholder: '',
  },
]