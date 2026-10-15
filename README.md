# TimeClock Multi-Tenant

Isolated multi-tenant staff time clock app.

## Setup
1. Create a new Supabase project.
2. Run the SQL in `schema.sql` in the Supabase SQL editor.
3. Enable Email auth in Supabase Authentication settings.
4. Copy the project URL and anon key into `config.js`.

## Features (basic tier)
- Shop owner signup/login
- Staff PIN management
- Tablet kiosk clock in/out + breaks
- Schedule upload
- Timesheets + CSV export
- Optional owner logo upload (TimeClock logo remains)

Existing Butty & Co. and Lamb & Co. projects remain completely separate.
