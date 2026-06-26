# ระบบลงเวลาเข้า-ออกงานด้วยใบหน้า (Face Attendance System)

Web app สแกนใบหน้าเพื่อลงเวลาเข้า-ออกงาน พร้อมบันทึกภาพใบหน้า, กำหนดกะ/OT, รายงาน, แดชบอร์ด และระบบสิทธิ์ Admin/User

เทคโนโลยี: **Node.js + TypeScript + Express**, **MariaDB**, **Angular 19 + Angular Material** (frontend), **face-api.js** (สแกนใบหน้าในเบราว์เซอร์), **Chart.js**, **Leaflet**, **Docker Compose**

---

## ความสามารถหลัก

| หมวด | รายละเอียด |
|------|-----------|
| สแกนใบหน้า | ใช้ webcam (Logitech) ลงเวลาเข้า-ออก + บันทึกภาพใบหน้าทุกครั้ง **รองรับหลายคนพร้อมกัน** |
| เลือกกล้อง | เลือกอุปกรณ์กล้องที่เชื่อมต่อได้ (จดจำค่าที่เลือกไว้) ทั้งหน้าสแกนและหน้าลงทะเบียน |
| กะการทำงาน | กำหนดช่วงเข้างาน / สายได้ถึง / ออกงาน / OT ได้เอง |
| จัดการพนักงาน | เพิ่ม-แก้-ลบ (soft delete), **ลงทะเบียนใบหน้า 3 ภาพ** (มีตัวเลข 1·2·3 + เครื่องหมายถูกสีเขียว), สร้างบัญชีเข้าระบบ |
| รายงาน | รายวัน / รายเดือน / รายปี — ส่งออก **Excel (.xlsx)** และ **PDF** |
| แดชบอร์ด | สรุปสถานะวันนี้ (โดนัท), แนวโน้ม 7 วัน (แท่ง), เจาะลึกรายบุคคล (เส้น) |
| ค้นหา/กรอง | ตามช่วงวันที่, พนักงาน, สถานะ (ตรงเวลา/สาย/ขาด/OT) |
| สิทธิ์ | **admin** = จัดการทั้งหมด, **user** = ดูเฉพาะข้อมูลตนเอง |

---

## วิธีติดตั้งและรัน (Docker — แนะนำ)

ต้องมี **Docker Desktop** ติดตั้งและเปิดอยู่

```bash
# 1) สร้างไฟล์ .env จากตัวอย่าง (แก้รหัสผ่าน/JWT_SECRET ให้ปลอดภัย)
cp .env.example .env

# 2) สร้างและรัน
docker compose up --build -d

# 3) เปิดเบราว์เซอร์
#    http://localhost:3000
```

> **สำคัญ:** การสแกนใบหน้าใช้กล้องผ่าน `getUserMedia` ซึ่งต้องเป็น **localhost** หรือ **HTTPS** เท่านั้น
> หากเปิดผ่าน IP เครื่องอื่น (เช่น 192.168.x.x) เบราว์เซอร์จะบล็อกกล้อง — ให้รันบนเครื่อง PC ที่ต่อกล้องและเปิด `http://localhost:3000`

### บัญชีเริ่มต้น
```
Username: admin
Password: admin1234
```
**โปรดเปลี่ยนรหัสผ่านหลังเข้าใช้ครั้งแรก** (สร้างผู้ใช้ใหม่และปิด/เปลี่ยนของเดิม)

---

## ขั้นตอนการใช้งานครั้งแรก

1. **เข้าสู่ระบบ** ด้วย admin
2. ไปที่ **กะการทำงาน** → ตรวจ/แก้กะเริ่มต้น "กะปกติ" ให้ตรงกับเวลาทำงานจริง
3. ไปที่ **พนักงาน** → เพิ่มพนักงาน (กรอกรหัส, ชื่อ, เลือกกะ)
4. กดปุ่ม **ใบหน้า** ของพนักงาน → เลือกกล้อง → เริ่มกล้อง → **ถ่ายภาพ 3 ครั้ง** (ช่อง 1·2·3 จะขึ้นเครื่องหมายถูกสีเขียวทีละภาพ) → กดบันทึก
5. ไปที่ **ลงเวลา (สแกน)** → เลือกกล้อง → กดเริ่มสแกน → หันหน้าเข้ากล้อง (ยืนพร้อมกันหลายคนได้) → ระบบลงเวลาให้อัตโนมัติ
6. ดูผลที่ **ประวัติการลงเวลา**, **แดชบอร์ด**, และ **รายงาน**

---

## ตรรกะการจำแนกการสแกน

ระบบตัดสินว่าเป็น เข้างาน/ออกงาน/OT จากเวลาปัจจุบันเทียบกับกะของพนักงาน:

- อยู่ในช่วง `[checkin_start, late_cutoff]` และยังไม่เข้างาน → **เข้างาน**
  (ก่อน `checkin_end` = ตรงเวลา, หลังจากนั้น = สาย)
- อยู่ในช่วง `[checkout_start, checkout_end]` และเข้างานแล้ว → **ออกงาน**
- อยู่ในช่วง `[ot_start, ot_end]` → **OT**
- สแกนซ้ำภายใน `FACE_COOLDOWN_MINUTES` นาที → ระบบข้ามให้ (กันบันทึกซ้ำ)

> เวลาทั้งหมดอิงตาม `TZ` ใน `.env` (ค่าเริ่มต้น `Asia/Bangkok`) — ต้องตั้งให้ตรงกับเขตเวลาของออฟฟิศ

---

## ตั้งค่า (.env)

| ตัวแปร | ความหมาย |
|--------|----------|
| `TZ` | เขตเวลา (ต้องตรงกับสถานที่จริง) |
| `JWT_SECRET` | กุญแจเซ็น token — **ต้องเปลี่ยนเป็นค่าสุ่มยาว** |
| `FACE_MATCH_THRESHOLD` | ระยะ Euclidean สูงสุดที่ถือว่าตรงกัน (น้อย=เข้มงวด, ค่าแนะนำ 0.5) |
| `FACE_COOLDOWN_MINUTES` | กันสแกนซ้ำกี่นาที |
| `FACE_IMAGE_DIR` | โฟลเดอร์เก็บภาพใบหน้า (map เป็น Docker volume) |
| `COMPANY_NAME` | ชื่อหน่วยงาน แสดงบน navbar + หัวรายงาน (ปัจจุบัน: สำนักงานสาธารณสุขจังหวัดนครราชสีมา) |
| `APP_NAME` | ชื่อระบบ แสดงบน navbar + หน้า login (ปัจจุบัน: ระบบลงเวลา KHD-FaceTo) |
| `TZ` | เขตเวลา (Asia/Bangkok) |

---

## โครงสร้างโปรเจกต์

```
khd-faceto/
├── docker-compose.yml        # app + mariadb + volumes
├── .env / .env.example
├── backend/                  # Node + TypeScript API
│   ├── src/
│   │   ├── routes/           # auth, employees, attendance, shifts, reports, dashboard
│   │   ├── services/         # faceCache (จับคู่ใบหน้า), shift (จำแนกสแกน), report (xlsx/pdf)
│   │   ├── middleware/       # JWT auth, error handler
│   │   └── index.ts
│   ├── db/migrations/        # SQL รันอัตโนมัติตอน MariaDB บูตครั้งแรก
│   └── assets/fonts/         # ฟอนต์ไทย Sarabun สำหรับ PDF
└── frontend-ng/               # Angular 19 + Angular Material SPA
    ├── src/app/
    │   ├── core/              # services (API), guards, interceptors, models
    │   ├── shared/             # app-shell (navbar/sidenav), responsive-table, dialogs
    │   └── features/          # login, dashboard, checkin, employees, attendance, reports, shifts, settings
    └── public/lib, public/models/  # face-api.min.js + โมเดล (โหลดแบบ on-demand เฉพาะหน้าที่ใช้กล้อง)
```

> Express เสิร์ฟ Angular build ที่ `frontend-ng/dist/frontend-ng/browser` (คอมไพล์ผ่าน multi-stage `backend/Dockerfile` ระหว่าง `docker compose up --build`) — ไม่ต้องสั่ง build แยก

---

## คำสั่งที่ใช้บ่อย

```bash
docker compose logs -f app      # ดู log แอป
docker compose down             # หยุด (เก็บข้อมูล)
docker compose down -v          # หยุด + ลบข้อมูลทั้งหมด (เริ่มใหม่หมด)
docker compose up --build -d    # build ใหม่หลังแก้โค้ด
```

### เชื่อมต่อฐานข้อมูลโดยตรง
```bash
docker compose exec mariadb mariadb -ukhdapp -p khd_attendance
# ตัวอย่าง: ดูการลงเวลาล่าสุด
# SELECT e.full_name, ar.scan_time, ar.scan_type, ar.status
#   FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id
#  ORDER BY ar.scan_time DESC LIMIT 10;
```

---

## ข้อมูลทดสอบ (Mock Data) — สำหรับดูฟีเจอร์ Dashboard/รายงาน

มีสคริปต์สร้างพนักงานสมมุติ 10 คน + ประวัติการลงเวลาตั้งแต่ต้นปีถึงวันนี้ (พนักงานรหัสขึ้นต้น `DEMO`)

```bash
# สร้าง/รีเฟรชข้อมูลทดสอบ (รันซ้ำได้ — ลบของเดิมที่ขึ้นต้น DEMO ก่อน)
docker compose cp ./backend/scripts/seed-mock.js app:/app/seed-mock.js
docker compose exec app node /app/seed-mock.js
docker compose restart app
```

ลบข้อมูลทดสอบทั้งหมด (เหลือเฉพาะข้อมูลจริง):
```bash
docker compose exec mariadb mariadb -ukhdapp -p"$DB_PASSWORD" khd_attendance \
  -e "DELETE ar FROM attendance_records ar JOIN employees e ON e.id=ar.employee_id WHERE e.employee_code LIKE 'DEMO%'; \
      DELETE fd FROM face_descriptors fd JOIN employees e ON e.id=fd.employee_id WHERE e.employee_code LIKE 'DEMO%'; \
      DELETE FROM employees WHERE employee_code LIKE 'DEMO%';"
```

> **หมายเหตุ:** ใบหน้าของพนักงาน DEMO เป็นค่าสุ่ม (ไม่ตรงกับใบหน้าจริงของใคร) ใช้สำหรับดูรายงาน/แดชบอร์ดเท่านั้น

---

## หมายเหตุด้านความปลอดภัย

- ออกแบบสำหรับใช้งานภายในองค์กร (kiosk/LAN) — หากเปิดสู่อินเทอร์เน็ตควรเพิ่ม HTTPS (reverse proxy)
- ภาพใบหน้าเข้าถึงได้เฉพาะผ่าน API ที่ตรวจสิทธิ์ (`/api/attendance/image/:id`) ไม่ใช่ static สาธารณะ
- รหัสผ่านเก็บแบบ bcrypt, ทุก API ป้องกันด้วย JWT + rate limit

---

## ประวัติการอัปเดต

- **2026-06-26** — ย้าย frontend ทั้งหมดจาก HTML/CSS/JS ธรรมดาไปเป็น **Angular 19 + Angular Material** (responsive: ตารางพับเป็นการ์ดบนมือถือ/แท็บเล็ตแทนการเลื่อนแนวนอน), ปรับธีมสี/โลโก้ให้ดูทันสมัยขึ้น (เหรียญตรา ✚ ไล่เฉดเขียว-teal, เงา, การ์ดโค้งมน), เพิ่มปุ่มแสดง/ซ่อนรหัสผ่านที่หน้า login, ลบหน้า "รายการลงเวลาล่าสุด" ที่ซ้ำกันในหน้าสแกนเพื่อขยายพื้นที่กล้อง, push ขึ้น GitHub ครั้งแรก
