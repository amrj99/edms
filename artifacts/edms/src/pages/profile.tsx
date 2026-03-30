import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  User, Lock, Bell, Clock, Save, Eye, EyeOff, Shield,
  Building2, CheckCircle2, Mail, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

// ─── Notification event groups ────────────────────────────────────────────────
const NOTIFICATION_GROUPS = [
  {
    label: "Documents",
    events: [
      { key: "document_uploaded",  label: "Document uploaded" },
      { key: "document_approved",  label: "Document approved" },
      { key: "document_rejected",  label: "Document rejected" },
    ],
  },
  {
    label: "Tasks",
    events: [
      { key: "task_assigned", label: "Task assigned to me" },
      { key: "task_overdue",  label: "Task overdue" },
    ],
  },
  {
    label: "Correspondence",
    events: [
      { key: "correspondence_received", label: "Correspondence received" },
      { key: "rfi_opened",              label: "RFI opened" },
      { key: "rfi_responded",           label: "RFI responded" },
      { key: "submittal_returned",      label: "Submittal returned" },
    ],
  },
  {
    label: "Transmittals",
    events: [
      { key: "transmittal_received",    label: "Transmittal received" },
      { key: "transmittal_acknowledged",label: "Transmittal acknowledged" },
    ],
  },
  {
    label: "Workflows",
    events: [
      { key: "workflow_action_required", label: "Workflow action required" },
    ],
  },
  {
    label: "Other",
    events: [
      { key: "mention", label: "Mentioned in a comment" },
      { key: "system",  label: "System notifications" },
    ],
  },
];

function roleBadgeColor(role: string) {
  const map: Record<string, string> = {
    system_owner:       "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    admin:              "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    project_manager:    "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    document_controller:"bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    reviewer:           "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    viewer:             "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300",
  };
  return map[role] ?? "bg-gray-100 text-gray-700";
}

function activityLabel(action: string, entityType: string) {
  const verb: Record<string, string> = {
    create: "Created",
    update: "Updated",
    delete: "Deleted",
    approve: "Approved",
    reject: "Rejected",
    submit: "Submitted",
    upload: "Uploaded",
  };
  const entity: Record<string, string> = {
    document:        "document",
    correspondence:  "correspondence",
    project:         "project",
    user:            "user",
    task:            "task",
    workflow:        "workflow",
    transmittal:     "transmittal",
    ncr:             "NCR",
    itr:             "ITR",
    noc:             "NOC",
    deliverable:     "deliverable",
  };
  return `${verb[action] ?? action} ${entity[entityType] ?? entityType}`;
}

// ─── Profile Info Tab ─────────────────────────────────────────────────────────
function ProfileInfoTab({ profile }: { profile: any }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    firstName:  profile.user.firstName,
    lastName:   profile.user.lastName,
    email:      profile.user.email,
    department: profile.user.department ?? "",
  });

  const updateProfile = useMutation({
    mutationFn: async (data: typeof form) => {
      const r = await fetch("/api/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message ?? "Failed to update profile");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Profile updated", description: "Your profile has been saved." });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    },
  });

  const isDirty =
    form.firstName  !== profile.user.firstName  ||
    form.lastName   !== profile.user.lastName   ||
    form.email      !== profile.user.email      ||
    (form.department || "") !== (profile.user.department || "");

  return (
    <div className="space-y-6">
      {/* Avatar + role strip */}
      <div className="flex items-center gap-4">
        <Avatar className="h-16 w-16 text-lg">
          <AvatarFallback className="bg-primary/10 text-primary font-semibold">
            {profile.user.firstName?.[0]}{profile.user.lastName?.[0]}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-lg font-semibold">{profile.user.firstName} {profile.user.lastName}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${roleBadgeColor(profile.user.role)}`}>
              <Shield className="h-3 w-3 mr-1" />
              {profile.user.role.replace(/_/g, " ")}
            </span>
            {profile.user.organizationName && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Building2 className="h-3 w-3" />
                {profile.user.organizationName}
              </span>
            )}
            {profile.user.department && (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                · {profile.user.department}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Member since {format(new Date(profile.user.createdAt), "MMMM d, yyyy")}
          </p>
        </div>
      </div>

      <Separator />

      {/* Editable fields */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="firstName">First Name</Label>
          <Input
            id="firstName"
            value={form.firstName}
            onChange={e => setForm(f => ({ ...f, firstName: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="lastName">Last Name</Label>
          <Input
            id="lastName"
            value={form.lastName}
            onChange={e => setForm(f => ({ ...f, lastName: e.target.value }))}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="email">Email Address</Label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              id="email"
              type="email"
              className="pl-9"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
            />
          </div>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="department">Department (optional)</Label>
          <Input
            id="department"
            value={form.department}
            onChange={e => setForm(f => ({ ...f, department: e.target.value }))}
            placeholder="e.g. Engineering, Contracts, Finance, Planning..."
          />
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          onClick={() => updateProfile.mutate(form)}
          disabled={!isDirty || updateProfile.isPending}
          className="gap-2"
        >
          {updateProfile.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>
    </div>
  );
}

// ─── Password Tab ─────────────────────────────────────────────────────────────
function PasswordTab() {
  const { toast } = useToast();
  const [form, setForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  const changePassword = useMutation({
    mutationFn: async (data: { currentPassword: string; newPassword: string }) => {
      const r = await fetch("/api/profile/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message ?? "Failed to change password");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Password changed", description: "Your password has been updated successfully." });
      setForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const passwordStrength = (p: string) => {
    if (!p) return null;
    if (p.length < 8) return { level: "weak", color: "text-red-500", label: "Too short" };
    const score = [/[A-Z]/, /[a-z]/, /[0-9]/, /[^A-Za-z0-9]/].filter(r => r.test(p)).length;
    if (score <= 2) return { level: "fair", color: "text-yellow-500", label: "Fair" };
    if (score === 3) return { level: "good", color: "text-blue-500", label: "Good" };
    return { level: "strong", color: "text-green-500", label: "Strong" };
  };
  const strength = passwordStrength(form.newPassword);
  const mismatch = form.confirmPassword && form.newPassword !== form.confirmPassword;
  const canSubmit = form.currentPassword && form.newPassword.length >= 8 && form.newPassword === form.confirmPassword;

  return (
    <div className="space-y-5 max-w-md">
      <div className="space-y-1.5">
        <Label htmlFor="currentPassword">Current Password</Label>
        <div className="relative">
          <Input
            id="currentPassword"
            type={showCurrent ? "text" : "password"}
            value={form.currentPassword}
            onChange={e => setForm(f => ({ ...f, currentPassword: e.target.value }))}
            placeholder="Enter your current password"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setShowCurrent(v => !v)}
          >
            {showCurrent ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="newPassword">New Password</Label>
        <div className="relative">
          <Input
            id="newPassword"
            type={showNew ? "text" : "password"}
            value={form.newPassword}
            onChange={e => setForm(f => ({ ...f, newPassword: e.target.value }))}
            placeholder="At least 8 characters"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setShowNew(v => !v)}
          >
            {showNew ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
          </Button>
        </div>
        {strength && (
          <p className={`text-xs ${strength.color}`}>{strength.label} password</p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="confirmPassword">Confirm New Password</Label>
        <Input
          id="confirmPassword"
          type="password"
          value={form.confirmPassword}
          onChange={e => setForm(f => ({ ...f, confirmPassword: e.target.value }))}
          placeholder="Repeat new password"
          className={mismatch ? "border-red-400 focus-visible:ring-red-400" : ""}
        />
        {mismatch && <p className="text-xs text-red-500">Passwords do not match</p>}
      </div>

      <Button
        onClick={() => changePassword.mutate({ currentPassword: form.currentPassword, newPassword: form.newPassword })}
        disabled={!canSubmit || changePassword.isPending}
        className="gap-2"
      >
        {changePassword.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Lock className="h-4 w-4" />
        )}
        Change Password
      </Button>
    </div>
  );
}

// ─── Notification Prefs Tab ───────────────────────────────────────────────────
function NotificationPrefsTab({ prefs: initialPrefs }: { prefs: Record<string, any> }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [prefs, setPrefs] = useState<Record<string, { inApp: boolean; email: boolean }>>(
    () => {
      const defaults: Record<string, { inApp: boolean; email: boolean }> = {};
      NOTIFICATION_GROUPS.forEach(g =>
        g.events.forEach(e => {
          defaults[e.key] = initialPrefs[e.key] ?? { inApp: true, email: false };
        }),
      );
      return defaults;
    },
  );

  const savePrefs = useMutation({
    mutationFn: async (data: typeof prefs) => {
      const r = await fetch("/api/profile/notification-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationPrefs: data }),
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.message ?? "Failed to save preferences");
      }
      return r.json();
    },
    onSuccess: () => {
      toast({ title: "Preferences saved", description: "Your notification settings have been updated." });
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    },
  });

  const toggle = (key: string, field: "inApp" | "email", value: boolean) => {
    setPrefs(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-[1fr_70px_70px] gap-x-4 items-center text-xs text-muted-foreground font-medium border-b pb-2">
        <span>Event</span>
        <span className="text-center">In-App</span>
        <span className="text-center">Email</span>
      </div>

      {NOTIFICATION_GROUPS.map(group => (
        <div key={group.label} className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{group.label}</p>
          {group.events.map(event => (
            <div key={event.key} className="grid grid-cols-[1fr_70px_70px] gap-x-4 items-center">
              <span className="text-sm">{event.label}</span>
              <div className="flex justify-center">
                <Switch
                  checked={prefs[event.key]?.inApp ?? true}
                  onCheckedChange={v => toggle(event.key, "inApp", v)}
                />
              </div>
              <div className="flex justify-center">
                <Switch
                  checked={prefs[event.key]?.email ?? false}
                  onCheckedChange={v => toggle(event.key, "email", v)}
                />
              </div>
            </div>
          ))}
        </div>
      ))}

      <div className="flex justify-end pt-2">
        <Button onClick={() => savePrefs.mutate(prefs)} disabled={savePrefs.isPending} className="gap-2">
          {savePrefs.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="h-4 w-4" />
          )}
          Save Preferences
        </Button>
      </div>
    </div>
  );
}

// ─── Activity Tab ──────────────────────────────────────────────────────────────
function ActivityTab({ activities }: { activities: any[] }) {
  if (activities.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <Clock className="h-10 w-10 mx-auto mb-3 opacity-30" />
        <p className="text-sm">No recent activity found.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {activities.map((a: any) => (
        <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg border bg-muted/20">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Clock className="h-4 w-4 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium capitalize">{activityLabel(a.action, a.entityType)}</p>
            {a.details?.title && (
              <p className="text-xs text-muted-foreground truncate">{a.details.title}</p>
            )}
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {format(new Date(a.createdAt), "MMM d, h:mm a")}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ProfilePage() {
  const { data, isLoading } = useQuery({
    queryKey: ["profile"],
    queryFn: async () => {
      const r = await fetch("/api/profile");
      if (!r.ok) throw new Error("Failed to load profile");
      return r.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">My Profile</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your account information, password, and notification preferences.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Tabs defaultValue="profile">
            <TabsList className="mb-6 grid w-full grid-cols-4">
              <TabsTrigger value="profile" className="gap-1.5 text-xs sm:text-sm">
                <User className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Profile</span>
              </TabsTrigger>
              <TabsTrigger value="password" className="gap-1.5 text-xs sm:text-sm">
                <Lock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Password</span>
              </TabsTrigger>
              <TabsTrigger value="notifications" className="gap-1.5 text-xs sm:text-sm">
                <Bell className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Notifications</span>
              </TabsTrigger>
              <TabsTrigger value="activity" className="gap-1.5 text-xs sm:text-sm">
                <Clock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Activity</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profile">
              <ProfileInfoTab profile={data} />
            </TabsContent>

            <TabsContent value="password">
              <PasswordTab />
            </TabsContent>

            <TabsContent value="notifications">
              <NotificationPrefsTab prefs={data.notificationPrefs ?? {}} />
            </TabsContent>

            <TabsContent value="activity">
              <ActivityTab activities={data.recentActivity ?? []} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
