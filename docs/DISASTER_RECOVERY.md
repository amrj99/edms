# DISASTER_RECOVERY.md — ArcScale EDMS
# دليل الاسترجاع الكامل من الصفر

> هذا الملف يجيب على سؤال واحد:
> **"لو مات السيرفر الآن — كيف أعيد كل شيء خلال ساعة؟"**
>
> آخر تحديث: 2026-09-02 (محدَّث لتقوية R1)

> ⚠️ **R1 (2026-09):** النسخ الآن **مشفّرة بـage** — لا تُستعاد بدون **مفتاح خاص محفوظ off-VPS** — وتُرفع/تُقرأ عبر **scoped token** (`BACKUP_R2_*`) مقيّد بـ`edms-backups` فقط. الكائنات صارت `nightly/*.dump.age` و`config/*.snap.age` و`files-mirror-enc/*.tar.age`. **الدرل يعمل خارج الـVPS.** الإجراء المشفّر الكامل + off-VPS drill في `docs/operations/BACKUP-AND-RECOVERY.md` (المرجع التفصيلي).

---

## 1. معلومات البنية التحتية

| العنصر | القيمة |
|---|---|
| مزود السيرفر | Hetzner VPS |
| عنوان IP | 178.104.126.120 |
| نظام التشغيل | Ubuntu 24.04 LTS |
| مسار المشروع | /var/www/edms |
| مزود DNS | Cloudflare |
| الدومين | arcscale.org / www.arcscale.org |
| التخزين السحابي | Cloudflare R2 |
| الـ Repository | https://github.com/amrj99/edms |
| الـ Branch الرئيسي | main |

---

## 2. الخدمات التي تعمل على السيرفر

| الخدمة | Container | المنفذ |
|---|---|---|
| API (Node.js/Express) | edms_api | 8080 (داخلي) |
| Frontend (React/Nginx) | edms_frontend | 80, 443 |
| قاعدة البيانات | edms_postgres | داخلي فقط |

---

## 3. إعادة بناء السيرفر من الصفر

### الخطوة 1 — تثبيت المتطلبات الأساسية

```bash
# تحديث النظام
apt update && apt upgrade -y

# تثبيت الأدوات الأساسية
apt install -y curl git unzip fail2ban

# تثبيت Docker
curl -fsSL https://get.docker.com | sh

# تثبيت AWS CLI (لاسترجاع النسخ الاحتياطية من R2)
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
cd /tmp && unzip -q awscliv2.zip && ./aws/install
```

### الخطوة 2 — إضافة Swap

```bash
fallocate -l 2G /swapfile
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
echo '/swapfile none swap sw 0 0' | tee -a /etc/fstab
echo 'vm.swappiness=10' | tee -a /etc/sysctl.conf
sysctl vm.swappiness=10
```

### الخطوة 3 — استنساخ المشروع

```bash
mkdir -p /var/www
cd /var/www
git clone https://github.com/amrj99/edms.git edms
cd edms
```

### الخطوة 4 — إنشاء ملف .env

```bash
nano /var/www/edms/.env
```

**المتغيرات المطلوبة — القيم في مكان آمن منفصل:**

```
NODE_ENV=production
PORT=8080
APP_URL=https://www.arcscale.org
DATABASE_URL=postgresql://edms:POSTGRES_PASSWORD@postgres:5432/edms
POSTGRES_PASSWORD=...
POSTGRES_USER=edms
POSTGRES_DB=edms
JWT_SECRET=...
REFRESH_TOKEN_SECRET=...
ALLOWED_ORIGINS=https://arcscale.org,https://www.arcscale.org
AI_MODEL=anthropic/claude-3.5-sonnet
AI_INTEGRATIONS_OPENAI_BASE_URL=https://openrouter.ai/api/v1
AI_INTEGRATIONS_OPENAI_API_KEY=...
OPENROUTER_API_KEY=...
RESEND_API_KEY=...
FROM_EMAIL=noreply@arcscale.org
FROM_NAME=ArcScale
DEFAULT_STORAGE_TYPE=onpremise
DEFAULT_STORAGE_PATH=/app/uploads
MAX_UPLOAD_SIZE_MB=1024
CF_ACCOUNT_ID=...
CF_AI_TOKEN=...
R2_ENDPOINT=https://....r2.cloudflarestorage.com
R2_BUCKET=edms-files
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
BACKUP_BUCKET=edms-backups
HEALTHCHECK_URL=https://hc-ping.com/...
# ── R1: scoped backup token (edms-backups only) + independent file dead-man ──
BACKUP_R2_ACCESS_KEY=...
BACKUP_R2_SECRET_KEY=...
FILES_HEALTHCHECK_URL=https://hc-ping.com/...
PHASE_D_ENFORCE_DEPT=true
```

> **R1 إضافي على الـVPS:** `apt-get install -y age` + ملف `/etc/edms-age-recipients.txt` (600) يحوي **المفتاحين العامّين** (`age1…`، سطر لكلٍّ). المفاتيح **الخاصة** محفوظة off-site فقط (لا على الـVPS) — تلزم للفكّ عند الاستعادة.

> ⚠️ القيم السرية محفوظة في مكان آمن منفصل عن هذا الملف.

### الخطوة 5 — تشغيل النظام

```bash
cd /var/www/edms
docker compose up -d

# انتظر 60 ثانية ثم تحقق
sleep 60
curl -s http://localhost:8080/api/health
```

---

## 4. استرجاع قاعدة البيانات من النسخة الاحتياطية

> ⚠️ **النسخ مشفّرة (`.dump.age`).** يجب فكّها بمفتاح age **خاص** (محفوظ off-site، ليس على هذا الـVPS) **قبل** `pg_restore`. استخدم الـ**scoped token** (`BACKUP_R2_*`) للقراءة.

### أ — تهيئة + عرض النسخ المشفّرة

```bash
source /var/www/edms/.env
a(){ AWS_ACCESS_KEY_ID="$BACKUP_R2_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_R2_SECRET_KEY" aws "$@" --endpoint-url "$R2_ENDPOINT" --region auto; }
a s3 ls s3://edms-backups/nightly/ | grep 'dump.age$'
```

### ب — تحميل أحدث نسخة مشفّرة

```bash
LATEST=$(a s3 ls s3://edms-backups/nightly/ | awk '{print $4}' | grep 'dump.age$' | sort | tail -1)
a s3 cp "s3://edms-backups/nightly/$LATEST" /tmp/db.age
echo "downloaded: $LATEST"
```

### ج — الفكّ بمفتاح خاص (off-VPS) ثم الاستعادة

```bash
# الفكّ (المفتاح الخاص محفوظ off-site — لا يُوضع على الإنتاج إلا لحظة الاستعادة الطارئة):
age -d -i /path/to/primary.key -o /tmp/restore.dump /tmp/db.age

docker compose up -d postgres && sleep 15

# إنشاء دورَي DEBT-010 قبل الاستعادة (وإلّا تفشل GRANTs في الـdump):
docker exec edms_postgres psql -U edms -d edms \
  -c "DO \$\$ BEGIN CREATE ROLE edms_app; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;" \
  -c "DO \$\$ BEGIN CREATE ROLE edms_rls_owner; EXCEPTION WHEN duplicate_object THEN NULL; END \$\$;"

docker exec -i edms_postgres pg_restore -U edms -d edms --clean --if-exists --no-owner < /tmp/restore.dump
shred -u /tmp/restore.dump /tmp/db.age

# ضبط كلمة سر edms_app لتطابق .env (ليست في الـdump):
docker exec -it edms_postgres psql -U edms -d edms -c "\\password edms_app"
```

### د — التحقق من الاسترجاع

```bash
docker exec edms_postgres psql -U edms -d edms -c "SELECT COUNT(*) FROM users;"
# تحقّق الأدوار: edms_app super=f/bypass=f
docker exec edms_postgres psql -U edms -d edms -c "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN ('edms_app','edms_rls_owner');"
```

> **ملفات onpremise:** لاستعادتها فُكّ أحدث `files-mirror-enc/*.tar.age` بنفس المفتاح الخاص وفكّ الـtar إلى volume `edms_uploads_data` (الخطوات في `BACKUP-AND-RECOVERY.md` §6 STEP 7).

---

## 5. استرجاع Cloudflare DNS

إعدادات DNS في Cloudflare Dashboard:

| النوع | الاسم | القيمة | Proxy |
|---|---|---|---|
| A | arcscale.org | 178.104.126.120 | ✅ Proxied |
| A | www.arcscale.org | 178.104.126.120 | ✅ Proxied |

**SSL/TLS Mode:** Full (strict)

---

## 6. استرجاع GitHub Actions Secrets

بعد إنشاء سيرفر جديد، يجب تحديث هذه الـ Secrets في GitHub:

```
https://github.com/amrj99/edms/settings/secrets/actions
```

| Secret | الوصف |
|---|---|
| SSH_PRIVATE_KEY | المفتاح الخاص للـ SSH الجديد |
| SSH_HOST | عنوان IP الجديد للسيرفر |
| SSH_USER | مستخدم السيرفر (root) |

**لإنشاء SSH Key جديد للـ CI/CD:**

```bash
ssh-keygen -t ed25519 -C "github-actions-edms" -f /root/.ssh/github_actions -N ""
cat /root/.ssh/github_actions.pub >> /root/.ssh/authorized_keys
chmod 600 /root/.ssh/authorized_keys
# انسخ محتوى /root/.ssh/github_actions إلى GitHub Secret
```

---

## 7. إعادة تفعيل النسخ الاحتياطي التلقائي

```bash
# تثبيت AWS CLI إذا لم يكن موجوداً
aws --version || (curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip && cd /tmp && unzip -q awscliv2.zip && ./aws/install)

# R1: تثبيت age + وضع المفتاحين العامّين (التشفير يتفعّل بوجود الملف)
apt-get install -y age
# /etc/edms-age-recipients.txt (600): سطرا age1… العامّان — من مخزنك off-site
# .env: BACKUP_R2_ACCESS_KEY/SECRET (scoped token) + FILES_HEALTHCHECK_URL

# اختبار السكريبت يدوياً (يجب أن يظهر: Encryption: ON (2 recipient(s)))
bash /var/www/edms/scripts/backup.sh

# تفعيل النسخ الاحتياطي التلقائي كل ليلة الساعة 2 صباحاً
(crontab -l 2>/dev/null; echo "0 2 * * * /var/www/edms/scripts/backup.sh >> /var/log/edms-backup.log 2>&1") | crontab -
```

---

## 8. إعادة تفعيل Fail2Ban

```bash
apt install fail2ban -y

cat > /etc/fail2ban/jail.local << 'EOF'
[DEFAULT]
findtime  = 10m
maxretry  = 5
bantime   = 1h
ignoreip  = 127.0.0.1/8

[sshd]
enabled  = true
port     = ssh
logpath  = %(sshd_log)s
backend  = systemd
maxretry = 3
bantime  = 24h
EOF

systemctl enable fail2ban && systemctl start fail2ban
```

---

## 9. التحقق الكامل بعد الاسترجاع

```bash
# 1. API يستجيب
curl -s http://localhost:8080/api/health

# 2. قاعدة البيانات متصلة
docker exec edms_postgres psql -U edms -d edms -c "SELECT 1;"

# 3. Containers تعمل
docker compose ps

# 4. النسخ الاحتياطي يعمل
bash /var/www/edms/scripts/backup.sh

# 5. Fail2Ban يعمل
fail2ban-client status sshd
```

---

## 10. قائمة الأسرار المطلوبة (Secrets Inventory)

> القيم الفعلية محفوظة بشكل آمن — هذه القائمة للتذكر فقط.

| السر | الاستخدام | دورة التجديد |
|---|---|---|
| POSTGRES_PASSWORD | قاعدة البيانات | 180 يوم |
| JWT_SECRET | توليد tokens للمستخدمين | 180 يوم |
| REFRESH_TOKEN_SECRET | تجديد جلسات المستخدمين | 180 يوم |
| R2_ACCESS_KEY | التطبيق: ملفات العملاء (edms-files) | 90 يوم |
| R2_SECRET_KEY | التطبيق: ملفات العملاء | 90 يوم |
| BACKUP_R2_ACCESS_KEY | scoped token للنسخ (edms-backups فقط) | 90 يوم |
| BACKUP_R2_SECRET_KEY | scoped token للنسخ | 90 يوم |
| age primary private key | **فكّ النسخ المشفّرة** — off-site فقط (لا على VPS) | ثابت (multi-recipient) |
| age break-glass private key | مفتاح فكّ احتياطي مستقل — off-site | ثابت |
| FILES_HEALTHCHECK_URL | مراقبة نسخ الملفات | ثابت |
| OPENROUTER_API_KEY | خدمات الذكاء الاصطناعي | عند الحاجة |
| RESEND_API_KEY | إرسال البريد الإلكتروني | عند الحاجة |
| CF_AI_TOKEN | Cloudflare AI | عند الحاجة |
| HEALTHCHECK_URL | مراقبة النسخ الاحتياطي | ثابت |
| SSH_PRIVATE_KEY (GitHub) | CI/CD النشر التلقائي | عند تغيير السيرفر |

---

## 11. وقت الاسترجاع المتوقع (RTO)

| المرحلة | الوقت المتوقع |
|---|---|
| تثبيت Ubuntu وDocker | 10 دقائق |
| استنساخ المشروع وإعداد .env | 10 دقائق |
| تشغيل Docker Compose | 5 دقائق |
| استرجاع قاعدة البيانات | 10 دقائق |
| التحقق الكامل | 5 دقائق |
| **المجموع** | **~40 دقيقة** |
