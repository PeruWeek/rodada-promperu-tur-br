// Test env stubs — applied before any test file runs.
process.env.SUPABASE_URL ??= "http://localhost/supabase";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-publishable";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role";
process.env.SUPABASE_PROJECT_ID ??= "test-project";