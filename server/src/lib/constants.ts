export const ACCOUNT_TYPES = ['personal', 'company', 'wholesaler', 'retailer', 'customer'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export const BUSINESS_TYPES = ['company', 'wholesaler', 'retailer'] as const;
export const isBusiness = (t: string) => (BUSINESS_TYPES as readonly string[]).includes(t);

/** Industries power business classification, interests, job industries, feed relevance and notifications. */
export const INDUSTRIES: [string, string][] = [
  ['technology', 'Technology'], ['software', 'Software'], ['ai', 'AI'], ['robotics', 'Robotics'],
  ['engineering', 'Engineering'], ['construction', 'Construction'], ['agriculture', 'Agriculture'],
  ['manufacturing', 'Manufacturing'], ['finance', 'Finance'], ['education', 'Education'],
  ['healthcare', 'Healthcare'], ['fashion', 'Fashion'], ['retail', 'Retail'], ['wholesale', 'Wholesale'],
  ['transport', 'Transport & Logistics'], ['hospitality', 'Hospitality & Tourism'],
  ['telecommunications', 'Telecommunications'], ['real-estate', 'Real Estate'], ['energy', 'Energy'],
  ['media', 'Media'], ['entertainment', 'Entertainment'], ['consulting', 'Consulting'],
  ['business', 'Business'], ['entrepreneurship', 'Entrepreneurship'], ['jobs', 'Jobs & Careers'],
  ['food-beverage', 'Food & Beverage'], ['mining', 'Mining'], ['other', 'Other'],
];

export const PRODUCT_CATEGORIES: [string, string][] = [
  ['electronics', 'Electronics'], ['phones-computers', 'Phones & Computers'], ['solar-energy', 'Solar & Energy'],
  ['building-materials', 'Building Materials'], ['agri-inputs', 'Agricultural Inputs'], ['food', 'Food & Groceries'],
  ['beverages', 'Beverages'], ['clothing', 'Clothing & Fashion'], ['beauty', 'Beauty & Personal Care'],
  ['health', 'Health & Pharmacy'], ['home-furniture', 'Home & Furniture'], ['vehicles-parts', 'Vehicles & Parts'],
  ['machinery', 'Machinery & Tools'], ['office-stationery', 'Office & Stationery'], ['textiles', 'Textiles'],
  ['services', 'Services'], ['other', 'Other'],
];

export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship', 'temporary', 'volunteer'] as const;
export const EDUCATION_LEVELS = ['none', 'secondary', 'certificate', 'diploma', 'bachelor', 'master', 'phd'] as const;
export const DOC_KINDS = ['cv', 'certificate', 'portfolio', 'cover_letter', 'id', 'academic', 'business_registration', 'other'] as const;
export const VISIBILITY = ['public', 'recruiters', 'private'] as const;
export const POST_KINDS = ['text', 'product', 'service', 'promotion', 'news', 'event', 'offer', 'update', 'hiring'] as const;
export const ANNOUNCEMENT_KINDS = [
  'price_increase', 'price_decrease', 'new_product', 'product_discontinued', 'new_service',
  'store_opening', 'service_interruption', 'hiring', 'promotion', 'event',
] as const;
export const PIPELINE = ['applied', 'reviewing', 'shortlisted', 'interview', 'final_review', 'accepted', 'rejected'] as const;
export const ORDER_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'] as const;
export const PAYMENT_METHODS = ['cash_on_delivery', 'mobile_money', 'bank_transfer'] as const;
export const REPORT_REASONS = ['spam', 'scam_or_fraud', 'fake_account', 'inappropriate', 'harassment', 'misleading', 'other'] as const;
export const CURRENCIES = ['TZS', 'KES', 'UGX', 'RWF', 'USD', 'EUR'] as const;
