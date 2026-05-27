# DISASTER_RECOVERY.md — ArcScale EDMS
# دليل الاسترجاع الكامل من الصفر

> هذا الملف يجيب على سؤال واحد:
> **"لو مات السيرفر الآن — كيف أعيد كل شيء خلال ساعة؟"**
>
> آخر تحديث: 2026-05-27

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
PHASE_D_ENFORCE_DEPT=true
```

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

### أ — عرض النسخ المتاحة في R2

```bash
AWS_ACCESS_KEY_ID=R2_ACCESS_KEY \
AWS_SECRET_ACCESS_KEY=R2_SECRET_KEY \
aws s3 ls s3://edms-backups/nightly/ \
  --endpoint-url https://....r2.cloudflarestorage.com \
  --region auto
```

### ب — تحميل النسخة المطلوبة

```bash
AWS_ACCESS_KEY_ID=R2_ACCESS_KEY \
AWS_SECRET_ACCESS_KEY=R2_SECRET_KEY \
aws s3 cp \
  s3://edms-backups/nightly/edms_YYYYMMDD_HHMMSS.dump \
  /tmp/restore.dump \
  --endpoint-url https://....r2.cloudflarestorage.com \
  --region auto
```

### ج — استرجاع قاعدة البيانات

```bash
# تأكد أن postgres يعمل أولاً
docker compose up -d postgres
sleep 15

# استرجاع النسخة
docker exec -i edms_postgres pg_restore \
  -U edms \
  -d edms \
  --clean \
  --if-exists \
  /tmp/restore.dump

# أو عبر pipe مباشرة
cat /tmp/restore.dump | docker exec -i edms_postgres pg_restore \
  -U edms -d edms --clean --if-exists
```

### د — التحقق من الاسترجاع

```bash
docker exec edms_postgres psql -U edms -d edms \
  -c "SELECT COUNT(*) FROM users;"
```

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

# اختبار السكريبت يدوياً
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
| R2_ACCESS_KEY | رفع واسترجاع الملفات من R2 | 90 يوم |
| R2_SECRET_KEY | رفع واسترجاع الملفات من R2 | 90 يوم |
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
