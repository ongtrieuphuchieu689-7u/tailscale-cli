# Lệnh `agent-manifest`

Xuất toàn bộ bản mô tả hợp đồng máy đọc được (**Agent Contract Manifest v2**) cho toàn bộ các lệnh và công cụ của CLI. Bản hợp đồng này định nghĩa cấu trúc inputs/outputs, quyền hạn (scopes, privileges), tác dụng phụ (side effects), tính chất retry (retryable), yêu cầu xác nhận tương tác và danh mục mã lỗi/warning.

---

## 1. Cú pháp & Tham số

```bash
tailsacle-cli agent-manifest [--json]
```

- `--json`: Xuất dưới dạng JSON envelope hoàn chỉnh.
- Mặc định: In trực tiếp schema JSON của manifest ra `stdout`.

---

## 2. Ví dụ Sử dụng Thực tế

```bash
tailsacle-cli agent-manifest --json
```

---

## 3. Các thành phần chính trong Manifest
- `manifestVersion: 2`
- `tools`: Danh sách toàn bộ các subcommand và schema chi tiết.
- `policy_writes`: Quy trình đồng bộ ACL an toàn (HuJSON preservation, diff, ETag).
- `cleanup_candidates`: Tiêu chí và quy tắc so khớp an toàn khi xoá device.
- `warnings`: Từ điển các mã cảnh báo và hướng dẫn khắc phục.
