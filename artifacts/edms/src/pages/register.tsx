import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { useRegister } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Loader2, Eye, EyeOff, AlertCircle, CheckCircle2, Lock, UserPlus, Building } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(50),
  lastName: z.string().min(1, "Last name is required").max(50),
  email: z.string().email("Please enter a valid email address"),
  organizationId: z.string().optional(),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type RegisterFormValues = z.infer<typeof registerSchema>;

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "At least 8 characters", valid: password.length >= 8 },
    { label: "Uppercase letter", valid: /[A-Z]/.test(password) },
    { label: "Number", valid: /[0-9]/.test(password) },
  ];

  if (!password) return null;

  return (
    <div className="mt-1 space-y-1">
      {checks.map((check) => (
        <div key={check.label} className="flex items-center gap-1.5 text-xs">
          <CheckCircle2
            className={`h-3 w-3 ${check.valid ? "text-green-500" : "text-muted-foreground/40"}`}
          />
          <span className={check.valid ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}>
            {check.label}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Create-Org Form ─────────────────────────────────────────────────────────
const orgRegSchema = z.object({
  orgName: z.string().min(2, "Organisation name must be at least 2 characters").max(100),
  adminFirstName: z.string().min(1, "First name is required").max(50),
  adminLastName: z.string().min(1, "Last name is required").max(50),
  adminEmail: z.string().email("Please enter a valid email address"),
  adminPassword: z.string().min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Must contain an uppercase letter")
    .regex(/[0-9]/, "Must contain a number"),
  confirmPassword: z.string(),
}).refine(d => d.adminPassword === d.confirmPassword, { message: "Passwords do not match", path: ["confirmPassword"] });

type OrgRegValues = z.infer<typeof orgRegSchema>;

function CreateOrgForm() {
  const [, setLocation] = useLocation();
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const form = useForm<OrgRegValues>({
    resolver: zodResolver(orgRegSchema),
    defaultValues: { orgName: "", adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "", confirmPassword: "" },
  });

  const pw = form.watch("adminPassword");

  const onSubmit = async (data: OrgRegValues) => {
    setServerError(null); setLoading(true);
    try {
      const r = await fetch("/api/auth/register-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgName: data.orgName,
          adminFirstName: data.adminFirstName,
          adminLastName: data.adminLastName,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
        }),
      });
      const json = await r.json();
      if (!r.ok) { setServerError(json.message ?? "Registration failed"); return; }
      setSuccess(`Organisation "${json.orgName}" created! Redirecting to login…`);
      setTimeout(() => setLocation("/login"), 2500);
    } catch {
      setServerError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        {serverError && <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{serverError}</AlertDescription></Alert>}
        {success && <Alert><CheckCircle2 className="h-4 w-4 text-green-500" /><AlertDescription>{success}</AlertDescription></Alert>}

        <FormField control={form.control} name="orgName" render={({ field }) => (
          <FormItem>
            <FormLabel>Organisation Name</FormLabel>
            <FormControl><Input placeholder="Acme Engineering" className="h-11" disabled={loading} {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="adminFirstName" render={({ field }) => (
            <FormItem><FormLabel>First name</FormLabel><FormControl><Input placeholder="John" className="h-11" disabled={loading} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="adminLastName" render={({ field }) => (
            <FormItem><FormLabel>Last name</FormLabel><FormControl><Input placeholder="Smith" className="h-11" disabled={loading} {...field} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>

        <FormField control={form.control} name="adminEmail" render={({ field }) => (
          <FormItem>
            <FormLabel>Admin Email</FormLabel>
            <FormControl><Input placeholder="admin@company.com" type="email" className="h-11" disabled={loading} {...field} /></FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="adminPassword" render={({ field }) => (
          <FormItem>
            <FormLabel>Password</FormLabel>
            <FormControl>
              <div className="relative">
                <Input placeholder="••••••••" type={showPw ? "text" : "password"} className="h-11 pr-10" disabled={loading} {...field} />
                <button type="button" onClick={() => setShowPw(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormControl>
            <PasswordStrength password={pw} />
            <FormMessage />
          </FormItem>
        )} />

        <FormField control={form.control} name="confirmPassword" render={({ field }) => (
          <FormItem>
            <FormLabel>Confirm password</FormLabel>
            <FormControl>
              <div className="relative">
                <Input placeholder="••••••••" type={showConfirm ? "text" : "password"} className="h-11 pr-10" disabled={loading} {...field} />
                <button type="button" onClick={() => setShowConfirm(v => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />

        <Button type="submit" className="w-full h-11 text-base font-semibold mt-2" disabled={loading || !!success}>
          {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating organisation…</> : "Create Organisation"}
        </Button>
      </form>
    </Form>
  );
}

// ─── Main Register Page ───────────────────────────────────────────────────────
export default function Register() {
  const { login: setAuthToken } = useAuth();
  const registerMutation = useRegister();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [mode, setMode] = useState<"join" | "create">("join");

  const { data: systemSettings, isLoading: settingsLoading } = useQuery({
    queryKey: ["system-settings-public"],
    queryFn: async () => {
      const r = await fetch("/api/config/system-settings");
      return r.json();
    },
  });

  const { data: orgsData } = useQuery({
    queryKey: ["organizations-public"],
    queryFn: async () => {
      const r = await fetch("/api/config/organizations-public");
      return r.json();
    },
  });
  const organizations: { id: number; name: string }[] = orgsData?.organizations ?? [];

  const form = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      organizationId: "_none",
      password: "",
      confirmPassword: "",
    },
  });

  const password = form.watch("password");

  const onSubmit = async (data: RegisterFormValues) => {
    setServerError(null);
    try {
      const orgId = data.organizationId && data.organizationId !== "_none"
        ? Number(data.organizationId)
        : undefined;
      const response = await registerMutation.mutateAsync({
        data: {
          email: data.email,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          ...(orgId !== undefined && { organizationId: orgId }),
        } as any,
      });
      if ((response as any).refreshToken) {
        localStorage.setItem("edms_refresh_token", (response as any).refreshToken);
      }
      setAuthToken(response.token);
    } catch (error: any) {
      const msg = error?.body?.message || error?.message || "Registration failed. Please try again.";
      setServerError(msg);
    }
  };

  const registrationEnabled = settingsLoading ? null : (systemSettings?.registrationEnabled ?? true);

  return (
    <div className="min-h-screen w-full flex bg-background">
      {/* Left panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-4 sm:px-6 lg:px-8">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <div className="flex justify-center mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/25">
                <Building2 className="h-8 w-8" />
              </div>
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground">
              Create your account
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Join ArcScale Engineering Document Management System
            </p>
          </div>

          {registrationEnabled === false ? (
            <div className="bg-card px-6 py-10 shadow-xl shadow-black/5 rounded-2xl border border-border/50 text-center space-y-4">
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted">
                  <Lock className="h-7 w-7 text-muted-foreground" />
                </div>
              </div>
              <div>
                <h3 className="text-lg font-semibold">Registration Disabled</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Public registration is currently disabled. Please contact your administrator to create an account.
                </p>
              </div>
              <Link href="/login" className="block">
                <Button className="w-full">Back to Login</Button>
              </Link>
            </div>
          ) : (

          <div className="bg-card px-6 py-8 shadow-xl shadow-black/5 rounded-2xl border border-border/50">
            {/* Mode Toggle */}
            <div className="flex rounded-lg border bg-muted p-1 mb-6 gap-1">
              <button
                type="button"
                onClick={() => setMode("join")}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${mode === "join" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <UserPlus className="h-3.5 w-3.5" /> Join Organisation
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                className={`flex-1 flex items-center justify-center gap-1.5 rounded-md py-2 text-sm font-medium transition-colors ${mode === "create" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Building className="h-3.5 w-3.5" /> Create Organisation
              </button>
            </div>

            {mode === "create" ? (
              <CreateOrgForm />
            ) : (
            <>
            {serverError && (
              <Alert variant="destructive" className="mb-6">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>First name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="John"
                            autoComplete="given-name"
                            disabled={registerMutation.isPending}
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Last name</FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Smith"
                            autoComplete="family-name"
                            disabled={registerMutation.isPending}
                            className="h-11"
                            {...field}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Work email address</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="you@company.com"
                          type="email"
                          autoComplete="email"
                          disabled={registerMutation.isPending}
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {organizations.length > 0 && (
                  <FormField
                    control={form.control}
                    name="organizationId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Organization <span className="text-muted-foreground text-xs font-normal">(optional)</span></FormLabel>
                        <Select onValueChange={field.onChange} value={field.value ?? "_none"} disabled={registerMutation.isPending}>
                          <FormControl>
                            <SelectTrigger className="h-11">
                              <SelectValue placeholder="Select your organization" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="_none">No organization / join later</SelectItem>
                            {organizations.map(org => (
                              <SelectItem key={org.id} value={String(org.id)}>
                                {org.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="••••••••"
                            type={showPassword ? "text" : "password"}
                            autoComplete="new-password"
                            disabled={registerMutation.isPending}
                            className="h-11 pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <PasswordStrength password={password} />
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="confirmPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input
                            placeholder="••••••••"
                            type={showConfirm ? "text" : "password"}
                            autoComplete="new-password"
                            disabled={registerMutation.isPending}
                            className="h-11 pr-10"
                            {...field}
                          />
                          <button
                            type="button"
                            onClick={() => setShowConfirm(!showConfirm)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Button
                  type="submit"
                  className="w-full h-11 text-base font-semibold mt-2"
                  disabled={registerMutation.isPending}
                >
                  {registerMutation.isPending ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating account...
                    </>
                  ) : (
                    "Create account"
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-6 text-center">
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login" className="text-primary font-medium hover:underline">
                  Sign in
                </Link>
              </p>
            </div>
            </>
            )}
          </div>
          )}
        </div>
      </div>

      {/* Right panel */}
      <div className="hidden lg:block relative w-0 flex-1 bg-slate-900">
        <img
          className="absolute inset-0 h-full w-full object-cover opacity-80 mix-blend-overlay"
          src={`${import.meta.env.BASE_URL}images/auth-bg.png`}
          alt="Architecture blueprint background"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/40 to-transparent" />
        <div className="absolute bottom-12 left-12 right-12 text-white">
          <h1 className="text-4xl font-bold tracking-tight mb-4">
            Start managing documents smarter.
          </h1>
          <p className="text-lg text-slate-300 max-w-xl leading-relaxed">
            Organize engineering documents, manage workflows, and keep your entire team in sync — all in one place.
          </p>
        </div>
      </div>
    </div>
  );
}
