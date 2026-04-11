/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { 
  Search, 
  ClipboardList, 
  Smartphone, 
  Zap, 
  ShieldCheck, 
  Database,
  CheckSquare,
  Moon, 
  Sun,
  Filter,
  ChevronRight,
  Info,
  AlertCircle,
  Layout,
  Lock,
  FileText,
  Activity,
  Download,
  Copy,
  Check,
  X,
  History
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { GoogleGenAI, Type } from "@google/genai";
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  User
} from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy, 
  onSnapshot,
  Timestamp,
  addDoc,
  serverTimestamp
} from 'firebase/firestore';
import { auth, db } from './firebase';

// --- AI Service ---
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// --- Data Structures ---

const USE_CASES = [
  { 
    id: 'UC-01', 
    name: 'Đăng ký customer', 
    goal: 'Khách hàng tạo tài khoản mới để sử dụng app.', 
    logic: 'Đăng ký bằng email. Không OTP, không verify email/phone.', 
    status: 'New',
    detailedContent: {
      preCondition: 'User chưa có tài khoản hoặc muốn tạo tài khoản mới.',
      trigger: 'User nhấn nút "Đăng ký" tại màn hình Login.',
      mainFlow: [
        '1. Hệ thống hiển thị form đăng ký (Email, Mật khẩu, Xác nhận mật khẩu).',
        '2. User nhập thông tin và nhấn "Đăng ký".',
        '3. Hệ thống kiểm tra định dạng email và độ mạnh mật khẩu.',
        '4. Hệ thống kiểm tra email đã tồn tại trong DB chưa.',
        '5. Hệ thống tạo record customer mới trong database.',
        '6. Hệ thống thông báo đăng ký thành công và chuyển về màn hình Login.'
      ],
      exceptionFlow: [
        '4a. Email đã tồn tại: Hệ thống báo lỗi "Email đã được sử dụng".',
        '3a. Mật khẩu không khớp: Hệ thống báo lỗi "Mật khẩu xác nhận không chính xác".'
      ],
      postCondition: 'Tài khoản mới được tạo thành công.',
      businessRules: 'Không yêu cầu verify email hay phone để đơn giản hóa flow ban đầu.',
      backendDependency: 'API POST /auth/sign-up/customer',
      notes: 'Cần lưu ý bảo mật mật khẩu bằng hashing (Bcrypt/Argon2).'
    }
  },
  { 
    id: 'UC-02', 
    name: 'Đăng nhập customer', 
    goal: 'Đăng nhập vào mobile app', 
    logic: 'Login bằng email/pass. Hỗ trợ auto-login bằng refresh token.', 
    status: 'Reuse',
    detailedContent: {
      preCondition: 'User đã có tài khoản.',
      trigger: 'User mở app hoặc nhấn "Đăng nhập" từ màn hình Register.',
      mainFlow: [
        '1. Hệ thống hiển thị màn hình Login.',
        '2. User nhập Email và Mật khẩu.',
        '3. Hệ thống gọi API xác thực.',
        '4. Backend trả về Access Token và Refresh Token.',
        '5. App lưu token vào Secure Storage và chuyển vào màn hình Home.'
      ],
      exceptionFlow: [
        '3a. Sai thông tin: Hệ thống báo "Email hoặc mật khẩu không đúng".',
        '3b. Tài khoản bị khóa: Hệ thống báo "Tài khoản tạm thời bị vô hiệu hóa".'
      ],
      postCondition: 'User vào được màn hình chính với quyền customer.',
      businessRules: 'Hỗ trợ Refresh Token để duy trì phiên đăng nhập.',
      backendDependency: 'API POST /auth/login/customer',
      notes: 'Token nên có thời hạn ngắn (e.g., 15-30 phút).'
    }
  },
  { 
    id: 'UC-03', 
    name: 'Đăng xuất customer', 
    goal: 'Kết thúc phiên làm việc hiện tại', 
    logic: 'Clear token local & revoke token server.', 
    status: 'New',
    detailedContent: {
      preCondition: 'User đang trong trạng thái đăng nhập.',
      trigger: 'User nhấn "Đăng xuất" trong màn hình Profile.',
      mainFlow: [
        '1. Hệ thống hiển thị popup xác nhận đăng xuất.',
        '2. User xác nhận.',
        '3. App gọi API revoke token lên server.',
        '4. App xóa sạch token và thông tin user ở local storage.',
        '5. App chuyển user về màn hình Login.'
      ],
      postCondition: 'User bị đẩy ra khỏi app, token không còn hiệu lực.',
      businessRules: 'Phải gọi API revoke để đảm bảo token không bị lợi dụng.',
      backendDependency: 'API POST /auth/logout/customer',
      notes: 'Xử lý cả trường hợp API logout lỗi vẫn phải clear local.'
    }
  },
  { 
    id: 'UC-04', 
    name: 'Xem menu theo chi nhánh', 
    goal: 'Xem danh sách sản phẩm đang bán tại chi nhánh đã chọn', 
    logic: 'Menu lấy từ product_availability. Báo lỗi nếu store đóng.', 
    status: 'Adjust',
    detailedContent: {
      preCondition: 'User đã chọn một chi nhánh (Store).',
      trigger: 'User vào màn hình Home/Menu.',
      mainFlow: [
        '1. App gửi Store ID lên server.',
        '2. Server trả về danh sách sản phẩm kèm trạng thái khả dụng (In stock/Out of stock).',
        '3. App hiển thị menu theo danh mục (Category).',
        '4. User có thể xem giá và hình ảnh món ăn.'
      ],
      postCondition: 'User thấy được menu thực tế của cửa hàng.',
      businessRules: 'Sản phẩm hết hàng vẫn hiện nhưng disable nút "Thêm vào giỏ".',
      backendDependency: 'API GET /product-availability/filter',
      notes: 'Cần cache menu để tăng tốc độ load.'
    }
  },
  { 
    id: 'UC-05', 
    name: 'Chọn chi nhánh', 
    goal: 'Chọn chi nhánh để làm cơ sở hiển thị menu và áp dụng nghiệp vụ liên quan', 
    logic: 'Dùng GPS gợi ý hoặc search thủ công. Không có branch mặc định.', 
    status: 'Adjust',
    detailedContent: {
      preCondition: 'User mở app hoặc muốn đổi chi nhánh.',
      trigger: 'User nhấn vào khu vực hiển thị chi nhánh ở Header.',
      mainFlow: [
        '1. App xin quyền truy cập vị trí (GPS).',
        '2. Nếu có GPS: App gợi ý danh sách chi nhánh gần nhất.',
        '3. Nếu không có GPS: User nhập tên quận/huyện để search.',
        '4. User chọn 1 chi nhánh.',
        '5. App lưu Store ID vào Local Storage và reload Menu.'
      ],
      postCondition: 'Store ID được cập nhật cho toàn app.',
      businessRules: 'Bắt buộc chọn store trước khi xem menu.',
      backendDependency: 'API GET /store/filter',
      notes: 'Xử lý mượt mà khi user từ chối quyền vị trí.'
    }
  },
  { 
    id: 'UC-06', 
    name: 'Xem voucher', 
    goal: 'Xem danh sách voucher và điều kiện áp dụng trước checkout', 
    logic: 'Voucher chỉ để xem. Hiện cả voucher không đủ điều kiện.', 
    status: 'Reuse',
    detailedContent: {
      preCondition: 'User đã đăng nhập.',
      trigger: 'User vào tab "Voucher" hoặc nhấn "Chọn voucher" ở Checkout.',
      mainFlow: [
        '1. App gọi API lấy danh sách voucher khả dụng cho user.',
        '2. Hệ thống hiển thị danh sách voucher kèm hạn dùng.',
        '3. User nhấn vào từng voucher để xem chi tiết điều kiện (Min spend, Max discount).',
        '4. User có thể copy mã hoặc nhấn "Dùng ngay".'
      ],
      postCondition: 'User nắm được các ưu đãi đang có.',
      businessRules: 'Voucher không đủ điều kiện (e.g. chưa tới ngày) vẫn hiện nhưng mờ đi.',
      backendDependency: 'API GET /vouchers/filter',
      notes: 'Phân loại voucher theo loại: Giảm giá, Miễn phí vận chuyển.'
    }
  },
  { 
    id: 'UC-07', 
    name: 'Thêm món vào yêu thích', 
    goal: 'Lưu sản phẩm để xem lại nhanh về sau', 
    logic: 'Lưu theo customer + product (không size). Đồng bộ thiết bị.', 
    status: 'New',
    detailedContent: {
      preCondition: 'User đã đăng nhập.',
      trigger: 'User nhấn icon Trái tim tại danh sách món hoặc chi tiết món.',
      mainFlow: [
        '1. App gửi yêu cầu thêm món vào list Favorite lên server.',
        '2. Server lưu mapping Customer ID + Product ID.',
        '3. App cập nhật trạng thái icon Trái tim (Filled).',
        '4. Hiển thị toast thông báo thành công.'
      ],
      postCondition: 'Sản phẩm xuất hiện trong danh sách yêu thích của user.',
      businessRules: 'Chỉ lưu ở mức sản phẩm, không lưu kèm option/size.',
      backendDependency: 'API POST /customer/favorites/products/{productId}',
      notes: 'Nên có hiệu ứng animation khi bấm tim.'
    }
  },
  { 
    id: 'UC-08', 
    name: 'Xem danh sách yêu thích', 
    goal: 'Xem toàn bộ sản phẩm đã đánh dấu yêu thích', 
    logic: 'Hiện cả item unavailable ở store hiện tại (disable nút Add).', 
    status: 'New',
    detailedContent: {
      preCondition: 'User đã đăng nhập.',
      trigger: 'User vào màn hình "Yêu thích" từ Profile hoặc Bottom Nav.',
      mainFlow: [
        '1. App gọi API lấy danh sách Favorite.',
        '2. Hệ thống hiển thị danh sách các món đã tim.',
        '3. Với mỗi món, check trạng thái availability tại store hiện tại.',
        '4. Hiển thị nút "Thêm nhanh" nếu món đang bán.'
      ],
      postCondition: 'User xem được các món mình quan tâm.',
      businessRules: 'Món hết hàng ở store hiện tại vẫn hiện nhưng có nhãn "Hết hàng".',
      backendDependency: 'API GET /customer/favorites/products',
      notes: 'Hỗ trợ xóa nhanh món khỏi list ngay tại màn hình này.'
    }
  },
  { 
    id: 'UC-09', 
    name: 'Bỏ món khỏi yêu thích', 
    goal: 'Xóa sản phẩm khỏi danh sách yêu thích', 
    logic: 'Xóa mapping customer + product.', 
    status: 'New',
    detailedContent: {
      preCondition: 'Sản phẩm đang nằm trong danh sách yêu thích.',
      trigger: 'User nhấn lại vào icon Trái tim (đang Filled).',
      mainFlow: [
        '1. App gửi yêu cầu xóa Favorite lên server.',
        '2. Server xóa record mapping.',
        '3. App cập nhật icon Trái tim về trạng thái rỗng.',
        '4. Xóa món khỏi danh sách hiển thị (nếu đang ở màn Favorite List).'
      ],
      postCondition: 'Sản phẩm không còn trong danh sách yêu thích.',
      businessRules: 'Đồng bộ ngay lập tức trên server.',
      backendDependency: 'API DELETE /customer/favorites/products/{productId}',
      notes: 'Cần confirm nếu user lỡ tay bấm xóa ở màn Favorite List.'
    }
  },
  { 
    id: 'UC-10', 
    name: 'Quản lý giỏ hàng (Cart)', 
    goal: 'Khách hàng có thể thêm món, chỉnh sửa, thay đổi số lượng hoặc xóa sản phẩm khỏi giỏ', 
    logic: 'Tính tiền theo giá store hiện tại. Chặn checkout nếu item unavailable.', 
    status: 'Local',
    detailedContent: {
      preCondition: 'User đã chọn món và option.',
      trigger: 'User nhấn "Thêm vào giỏ" hoặc vào màn hình Giỏ hàng.',
      mainFlow: [
        '1. App lưu thông tin món (ID, Size, Topping, Qty) vào Local Storage.',
        '2. Tại màn Giỏ hàng: App tính toán tổng tiền tạm tính.',
        '3. User có thể tăng/giảm số lượng món.',
        '4. User có thể xóa món khỏi giỏ.',
        '5. App tự động re-validate giá khi store thay đổi.'
      ],
      postCondition: 'Giỏ hàng được cập nhật chính xác.',
      businessRules: 'Giỏ hàng lưu local để khách có thể chọn món khi offline (nhưng không checkout được).',
      backendDependency: 'API Revalidate Cart (Check giá & stock)',
      notes: 'Cần xử lý xung đột giá khi user để giỏ hàng quá lâu.'
    }
  },
  { 
    id: 'UC-11', 
    name: 'Thanh toán & Đặt hàng (Checkout)', 
    goal: 'Xác nhận và gửi đơn đặt hàng lên hệ thống chuỗi cửa hàng', 
    logic: 'Chọn Pickup/Delivery, áp voucher, chọn tiền mặt/online.', 
    status: 'New',
    detailedContent: {
      preCondition: 'Giỏ hàng có ít nhất 1 sản phẩm khả dụng.',
      trigger: 'User nhấn "Thanh toán" từ màn hình Giỏ hàng.',
      mainFlow: [
        '1. User chọn hình thức nhận hàng (Tại chỗ/Mang đi/Giao hàng).',
        '2. User chọn Voucher (nếu có).',
        '3. User chọn phương thức thanh toán (Tiền mặt/Chuyển khoản/Ví điện tử).',
        '4. User nhấn "Đặt hàng".',
        '5. App gọi API tạo đơn hàng.',
        '6. Nếu thanh toán online: Chuyển sang màn hình Payment QR.'
      ],
      exceptionFlow: [
        '5a. Món ăn vừa hết hàng: Hệ thống báo lỗi và yêu cầu cập nhật giỏ hàng.',
        '5b. Voucher hết hạn: Hệ thống yêu cầu gỡ voucher.'
      ],
      postCondition: 'Đơn hàng được tạo trên server, giỏ hàng local được xóa.',
      businessRules: 'Chỉ cho phép đặt hàng khi store đang trạng thái Open.',
      backendDependency: 'API POST /orders/customer',
      notes: 'Cần tích hợp Webhook để nhận kết quả thanh toán online.'
    }
  },
];

const WORKFLOWS = [
  {
    id: 'WF-01',
    name: 'Xác thực & Tài khoản',
    goal: 'Quản lý việc đăng nhập, đăng ký, đăng xuất và phiên làm việc của khách hàng.',
    actor: 'Customer',
    status: 'New',
    detailedContent: {
      preCondition: 'Khách hàng đã tải app.',
      trigger: 'Khách hàng mở app hoặc chọn tính năng yêu cầu đăng nhập.',
      mainFlow: [
        '1. Khách hàng mở app, hệ thống tự động kiểm tra refresh token (UC-02).',
        '2. Nếu chưa đăng nhập, hiển thị màn hình Login (SCR-02).',
        '3. Khách hàng có thể chọn Đăng ký (UC-01) nếu chưa có tài khoản.',
        '4. Sau khi đăng nhập thành công, chuyển hướng đến Home (SCR-04).',
        '5. Khách hàng có thể xem thông tin tài khoản và Đăng xuất (UC-03) tại màn hình Account (SCR-14).'
      ],
      exceptionFlow: [
        'Token hết hạn: Yêu cầu đăng nhập lại.',
        'Sai thông tin đăng nhập: Hiển thị lỗi tương ứng.'
      ],
      postCondition: 'Khách hàng có thể truy cập các tính năng yêu cầu đăng nhập.',
      businessRules: 'Không yêu cầu verify email hay phone để đơn giản hóa flow ban đầu.',
      backendDependency: 'API POST /auth/login/customer, API POST /auth/sign-up/customer',
      notes: 'Cần xử lý mượt mà việc auto login.'
    }
  },
  {
    id: 'WF-02',
    name: 'Chọn Cửa Hàng & Xem Menu',
    goal: 'Cho phép khách hàng chọn cửa hàng phù hợp và xem menu theo tình trạng hàng hóa của cửa hàng đó.',
    actor: 'Customer',
    status: 'Adjust',
    detailedContent: {
      preCondition: 'Khách hàng đã đăng nhập.',
      trigger: 'Khách hàng vào màn hình Home hoặc muốn đổi cửa hàng.',
      mainFlow: [
        '1. Hệ thống yêu cầu quyền vị trí (WF-05).',
        '2. Hệ thống gợi ý cửa hàng gần nhất hoặc khách hàng tự chọn (UC-05).',
        '3. Hệ thống tải danh sách sản phẩm khả dụng tại cửa hàng đã chọn (UC-04).',
        '4. Khách hàng duyệt menu tại Home (SCR-04).'
      ],
      exceptionFlow: [
        'Cửa hàng đóng cửa: Hiển thị thông báo, chặn thêm vào giỏ hàng.',
        'Không có cửa hàng nào gần: Yêu cầu chọn thủ công.'
      ],
      postCondition: 'Khách hàng xem được menu của cửa hàng đã chọn.',
      businessRules: 'Menu hiển thị theo product availability của store.',
      backendDependency: 'API GET /store/filter, API GET /product-availability/filter',
      notes: 'Khoảng cách store cần tính toán từ tọa độ GPS.'
    }
  },
  {
    id: 'WF-03',
    name: 'Quản lý Voucher',
    goal: 'Khách hàng có thể xem, kiểm tra điều kiện và áp dụng voucher cho đơn hàng.',
    actor: 'Customer',
    status: 'Adjust',
    detailedContent: {
      preCondition: 'Khách hàng đã đăng nhập.',
      trigger: 'Khách hàng vào màn hình Voucher hoặc Checkout.',
      mainFlow: [
        '1. Khách hàng truy cập danh sách Voucher (SCR-06).',
        '2. Hệ thống phân loại voucher khả dụng và không khả dụng dựa trên giỏ hàng hiện tại (UC-06).',
        '3. Khách hàng xem chi tiết điều kiện voucher (SCR-07).',
        '4. Khách hàng chọn áp dụng voucher hợp lệ vào đơn hàng (UC-11).'
      ],
      exceptionFlow: [
        'Voucher hết hạn hoặc hết lượt: Hiển thị trạng thái không khả dụng.',
        'Giỏ hàng chưa đủ điều kiện: Hiển thị lý do (VD: Thiếu 20k).'
      ],
      postCondition: 'Voucher được áp dụng thành công vào giỏ hàng.',
      businessRules: 'Chỉ áp dụng 1 voucher trên 1 đơn hàng.',
      backendDependency: 'API GET /vouchers/filter, API GET /vouchers/{id}',
      notes: 'Nội dung điều kiện lấy từ trường description của API.'
    }
  },
  {
    id: 'WF-04',
    name: 'Sản phẩm Yêu thích',
    goal: 'Khách hàng lưu lại các món ăn yêu thích để dễ dàng đặt lại.',
    actor: 'Customer',
    status: 'New',
    detailedContent: {
      preCondition: 'Khách hàng đã đăng nhập.',
      trigger: 'Khách hàng nhấn icon trái tim trên món ăn.',
      mainFlow: [
        '1. Tại màn hình Home hoặc Chi tiết món, khách hàng nhấn icon trái tim (UC-07).',
        '2. Hệ thống lưu sản phẩm vào danh sách yêu thích.',
        '3. Khách hàng truy cập màn hình Yêu thích (SCR-08) để xem danh sách (UC-08).',
        '4. Khách hàng có thể bỏ yêu thích bằng cách nhấn lại icon trái tim (UC-09).'
      ],
      exceptionFlow: [
        'Lỗi mạng: Hiển thị toast thông báo không thể cập nhật.'
      ],
      postCondition: 'Danh sách yêu thích được cập nhật.',
      businessRules: 'Danh sách yêu thích lưu trên server.',
      backendDependency: 'API POST /customer/favorites/products, API GET /customer/favorites/products',
      notes: 'Cần đồng bộ trạng thái yêu thích giữa các màn hình.'
    }
  },
  {
    id: 'WF-05',
    name: 'Xử lý Quyền Vị Trí',
    goal: 'Đảm bảo app có quyền truy cập vị trí để gợi ý cửa hàng chính xác.',
    actor: 'Customer',
    status: 'Local',
    detailedContent: {
      preCondition: 'App cần lấy vị trí hiện tại.',
      trigger: 'Lần đầu mở app hoặc khi cần tìm cửa hàng gần nhất.',
      mainFlow: [
        '1. Hệ thống hiển thị màn hình xin quyền vị trí (SCR-15).',
        '2. Khách hàng nhấn Cho phép.',
        '3. Hệ thống gọi API OS để lấy tọa độ.',
        '4. Chuyển hướng về màn hình Chọn cửa hàng (SCR-05) với danh sách đã sắp xếp theo khoảng cách.'
      ],
      exceptionFlow: [
        'Khách hàng từ chối: Chuyển đến màn hình Chọn cửa hàng thủ công.',
        'GPS bị tắt: Yêu cầu bật GPS trong cài đặt thiết bị.'
      ],
      postCondition: 'App nhận được tọa độ GPS hoặc khách hàng từ chối.',
      businessRules: 'Không bắt buộc phải có GPS mới dùng được app.',
      backendDependency: 'OS Permission',
      notes: 'Đây là bước đệm để tăng tỷ lệ user cho phép GPS.'
    }
  },
  {
    id: 'WF-06',
    name: 'Giỏ hàng & Thanh toán',
    goal: 'Khách hàng thêm món vào giỏ, chọn phương thức nhận hàng, thanh toán và hoàn tất đơn hàng.',
    actor: 'Customer',
    status: 'Reuse',
    detailedContent: {
      preCondition: 'Khách hàng đã chọn cửa hàng và có món trong giỏ.',
      trigger: 'Khách hàng nhấn nút Thanh toán từ Giỏ hàng.',
      mainFlow: [
        '1. Khách hàng chọn món, tùy chỉnh size/topping và thêm vào giỏ (UC-10).',
        '2. Khách hàng vào Giỏ hàng (SCR-10) để kiểm tra.',
        '3. Khách hàng tiến hành Checkout (SCR-11), chọn phương thức nhận hàng và thanh toán (UC-11).',
        '4. Nếu thanh toán online, chuyển sang màn hình SePay QR (SCR-12).',
        '5. Hệ thống xác nhận đơn hàng và chuyển sang màn hình Thành công (SCR-13).'
      ],
      exceptionFlow: [
        'Món hết hàng khi checkout: Yêu cầu khách hàng xóa khỏi giỏ.',
        'Thanh toán thất bại/Timeout: Hủy đơn hoặc yêu cầu thử lại.'
      ],
      postCondition: 'Đơn hàng được tạo thành công.',
      businessRules: 'Giỏ hàng lưu local, giữ lại khi đóng app.',
      backendDependency: 'API POST /orders/customer, API POST /payments/sepay/qr',
      notes: 'Cần polling API để check trạng thái thanh toán liên tục.'
    }
  },
  {
    id: 'WF-07',
    name: 'Rule Giỏ hàng khi đổi Cửa hàng',
    goal: 'Đảm bảo tính nhất quán của giỏ hàng khi khách hàng thay đổi cửa hàng đang chọn.',
    actor: 'Customer',
    status: 'Adjust',
    detailedContent: {
      preCondition: 'Giỏ hàng đang có sản phẩm và khách hàng đổi sang cửa hàng khác.',
      trigger: 'Khách hàng đổi cửa hàng tại màn hình SCR-05.',
      mainFlow: [
        '1. Khách hàng đổi cửa hàng tại màn hình SCR-05.',
        '2. Hệ thống tự động quét lại giỏ hàng local.',
        '3. Kiểm tra tính khả dụng của từng món tại cửa hàng mới (UC-10).',
        '4. Cập nhật giá bán nếu có sự chênh lệch.',
        '5. Thông báo cho khách hàng về các thay đổi (món bị xóa do hết hàng, giá thay đổi).'
      ],
      exceptionFlow: [
        'Tất cả món đều hết hàng: Làm trống giỏ hàng và thông báo.'
      ],
      postCondition: 'Giỏ hàng được cập nhật theo tình trạng của cửa hàng mới.',
      businessRules: 'Ưu tiên lưu Local. Xóa món hết hàng, cập nhật giá bán mới.',
      backendDependency: 'API GET /product-availability/filter',
      notes: 'Cần xử lý mượt mà để không làm gián đoạn trải nghiệm.'
    }
  }
];

const SCREENS = [
  { 
    id: 'SCR-01', 
    name: 'Session Check', 
    target: 'Kiểm tra session, refresh token, selected store local và cart local trước khi vào app', 
    states: 'Loading, Session valid, Session invalid, Refresh failed',
    detailedContent: {
      entryCondition: 'User mở ứng dụng.',
      uiComponents: [
        '- Splash Screen với Logo thương hiệu.',
        '- Loading spinner hoặc progress bar.'
      ],
      userActions: 'Không có action trực tiếp, hệ thống tự xử lý.',
      validation: 'Kiểm tra tính hợp lệ của JWT trong Secure Storage.',
      dataApi: 'API POST /auth/refresh/customer',
      uiStates: 'Loading (đang check), Error (mạng lỗi), Redirect (vào Home hoặc Login).',
      navigation: 'Chuyển sang SCR-02 (Login) nếu token hết hạn, hoặc SCR-04 (Home) nếu hợp lệ.',
      notes: 'Màn hình này diễn ra rất nhanh, cần tối ưu performance.'
    }
  },
  { 
    id: 'SCR-02', 
    name: 'Login', 
    target: 'Cho customer đăng nhập bằng email và mật khẩu.', 
    states: 'Default, Disabled submit, Loading, Error credentials, Network error',
    detailedContent: {
      entryCondition: 'User chưa đăng nhập hoặc session hết hạn.',
      uiComponents: [
        '- Trường nhập Email.',
        '- Trường nhập Mật khẩu (có icon ẩn/hiện).',
        '- Nút "Đăng nhập".',
        '- Link "Đăng ký tài khoản mới".',
        '- Link "Quên mật khẩu".'
      ],
      userActions: 'Nhập thông tin, nhấn Login, chuyển sang màn Register.',
      validation: 'Email đúng format, Mật khẩu không để trống.',
      dataApi: 'API POST /auth/login/customer',
      uiStates: 'Default, Loading (khi bấm nút), Error (sai pass/email).',
      navigation: 'Thành công -> SCR-04 (Home). Bấm đăng ký -> SCR-03 (Register).',
      notes: 'Nên lưu email cuối cùng đăng nhập để tiện cho user.'
    }
  },
  { 
    id: 'SCR-03', 
    name: 'Register', 
    target: 'Tạo tài khoản customer mới.', 
    states: 'Default, Validation error, Loading, Email existed, Network error, Register success',
    detailedContent: {
      entryCondition: 'User nhấn "Đăng ký" từ màn Login.',
      uiComponents: [
        '- Trường nhập Email.',
        '- Trường nhập Mật khẩu.',
        '- Trường nhập Xác nhận mật khẩu.',
        '- Nút "Đăng ký".'
      ],
      userActions: 'Nhập thông tin, nhấn Register.',
      validation: 'Email hợp lệ, Pass >= 8 ký tự, Confirm Pass phải khớp.',
      dataApi: 'API POST /auth/sign-up/customer',
      uiStates: 'Default, Loading, Success (hiện toast), Error (email trùng).',
      navigation: 'Thành công -> SCR-02 (Login).',
      notes: 'Chưa hỗ trợ đăng ký bằng Số điện thoại trong phase này.'
    }
  },
  { 
    id: 'SCR-04', 
    name: 'Home / Menu', 
    target: 'Màn hình chính hiển thị store đang chọn, menu theo chi nhánh, truy cập nhanh các chức năng', 
    states: 'Loading skeleton, No store selected, Menu loaded, Empty menu, Store closed, Product unavailable, API error, Offline',
    detailedContent: {
      entryCondition: 'Sau khi Login thành công hoặc mở app khi đã có session.',
      uiComponents: [
        '- Header: Tên Store hiện tại + Nút đổi Store.',
        '- Banner khuyến mãi (Carousel).',
        '- Danh mục sản phẩm (Tabs/Icons).',
        '- Danh sách sản phẩm (Grid/List) kèm giá và nút Add.',
        '- Bottom Navigation Bar.'
      ],
      userActions: 'Chọn store, chọn category, nhấn vào sản phẩm, nhấn Add to cart nhanh.',
      validation: 'Kiểm tra store status (Open/Closed) trước khi cho Add.',
      dataApi: 'API GET /product-availability/filter, API GET /store/{id}',
      uiStates: 'Skeleton loading, Loaded, Store Closed (hiện overlay mờ).',
      navigation: 'Bấm store -> SCR-05. Bấm món -> SCR-09. Bấm giỏ hàng -> SCR-10.',
      notes: 'Cần xử lý lazy load cho danh sách sản phẩm dài.'
    }
  },
  { 
    id: 'SCR-05', 
    name: 'Store Selector', 
    target: 'Chọn chi nhánh thủ công hoặc theo GPS', 
    states: 'First load, Request location permission, Location granted, Location denied, Loading stores, Empty result, Error, Revalidating cart, Store changed',
    detailedContent: {
      entryCondition: 'User nhấn vào Header Store hoặc lần đầu vào app chưa chọn store.',
      uiComponents: [
        '- Search bar tìm kiếm store.',
        '- Nút "Sử dụng vị trí hiện tại".',
        '- Danh sách Store (Tên, Địa chỉ, Khoảng cách).',
        '- Map view (tùy chọn).'
      ],
      userActions: 'Cho phép/Từ chối GPS, Search store, Chọn store.',
      validation: 'Phải chọn 1 store để tiếp tục.',
      dataApi: 'API GET /store/filter',
      uiStates: 'Loading, List loaded, No results.',
      navigation: 'Chọn xong -> Quay lại SCR-04.',
      notes: 'Khoảng cách store cần tính toán từ tọa độ GPS.'
    }
  },
  { 
    id: 'SCR-06', 
    name: 'Voucher List', 
    target: 'Xem danh sách voucher, có thể vào từ tab Voucher hoặc từ Checkout', 
    states: 'Loading, Empty, Loaded, Error',
    detailedContent: {
      entryCondition: 'User vào tab Voucher hoặc nhấn "Chọn voucher" tại Checkout.',
      uiComponents: [
        '- Danh sách card Voucher.',
        '- Nhãn "Sắp hết hạn", "Mới".',
        '- Nút "Điều kiện" trên mỗi card.'
      ],
      userActions: 'Xem voucher, nhấn xem chi tiết.',
      validation: 'Phân loại voucher khả dụng và không khả dụng.',
      dataApi: 'API GET /vouchers/filter',
      uiStates: 'Loading, Loaded, Empty.',
      navigation: 'Bấm chi tiết -> SCR-07.',
      notes: 'Voucher không đủ điều kiện cần hiển thị lý do (e.g. thiếu 20k để áp dụng).'
    }
  },
  { 
    id: 'SCR-07', 
    name: 'Voucher Detail', 
    target: 'Xem chi tiết điều kiện voucher', 
    states: 'Loaded, Error',
    detailedContent: {
      entryCondition: 'User nhấn vào 1 voucher cụ thể.',
      uiComponents: [
        '- Tên voucher, mã voucher.',
        '- Nội dung chi tiết điều kiện (Text/List).',
        '- Thời gian áp dụng.',
        '- Nút "Sử dụng ngay".'
      ],
      userActions: 'Đọc thông tin, copy mã.',
      validation: 'N/A',
      dataApi: 'API GET /vouchers/{id}',
      uiStates: 'Loaded, Error.',
      navigation: 'Quay lại SCR-06.',
      notes: 'Nội dung điều kiện lấy từ trường description của API.'
    }
  },
  { 
    id: 'SCR-08', 
    name: 'Favorite List', 
    target: 'Xem danh sách sản phẩm yêu thích', 
    states: 'Loading, Empty favorite, Loaded, Error, Removing favorite pending',
    detailedContent: {
      entryCondition: 'User vào mục "Yêu thích" từ Profile.',
      uiComponents: [
        '- Danh sách sản phẩm đã tim.',
        '- Nút gỡ khỏi yêu thích (icon tim filled).',
        '- Nút "Thêm vào giỏ" nhanh.'
      ],
      userActions: 'Xem món, gỡ yêu thích, thêm vào giỏ.',
      validation: 'Check availability của món tại store hiện tại.',
      dataApi: 'API GET /customer/favorites/products',
      uiStates: 'Loading, Empty, Loaded.',
      navigation: 'Bấm vào món -> SCR-09.',
      notes: 'Nếu món hết hàng, hiện nhãn "Hết hàng tại chi nhánh này".'
    }
  },
  { 
    id: 'SCR-09', 
    name: 'Product Detail', 
    target: 'Xem chi tiết món, chọn size, topping, ghi chú món, thêm vào giỏ', 
    states: 'Loading, Loaded, Missing mandatory option, Product unavailable, Store closed, Add to cart success/fail',
    detailedContent: {
      entryCondition: 'User nhấn vào 1 sản phẩm từ Menu hoặc Favorite.',
      uiComponents: [
        '- Ảnh sản phẩm lớn.',
        '- Tên và mô tả món.',
        '- Selector Size (S, M, L).',
        '- Selector Topping (Checkbox list).',
        '- Trường nhập Ghi chú.',
        '- Bộ tăng giảm số lượng.',
        '- Nút "Thêm vào giỏ" kèm tổng tiền.'
      ],
      userActions: 'Chọn option, nhập ghi chú, thay đổi số lượng, nhấn Add to cart.',
      validation: 'Bắt buộc chọn size (nếu có), topping theo số lượng min/max cho phép.',
      dataApi: 'API GET /product-availability/filter (lấy detail)',
      uiStates: 'Loading, Loaded, Out of stock.',
      navigation: 'Thành công -> Quay lại SCR-04 hoặc SCR-08.',
      notes: 'Giá tiền phải nhảy động khi user chọn size/topping.'
    }
  },
  { 
    id: 'SCR-10', 
    name: 'Cart', 
    target: 'Xem giỏ hàng, chỉnh số lượng, xóa món, xem cảnh báo availability', 
    states: 'Loading, Empty cart, Loaded, Item unavailable, Store mismatch, Repricing/revalidation, Error',
    detailedContent: {
      entryCondition: 'User nhấn vào icon Giỏ hàng.',
      uiComponents: [
        '- Danh sách món trong giỏ.',
        '- Thông tin store đang chọn.',
        '- Tổng tiền tạm tính.',
        '- Nút "Thanh toán".'
      ],
      userActions: 'Thay đổi số lượng, xóa món, nhấn Thanh toán.',
      validation: 'Re-validate toàn bộ giỏ hàng với server trước khi cho checkout.',
      dataApi: 'API Revalidate Cart',
      uiStates: 'Loading, Loaded, Item Error (món bị đổi giá hoặc hết hàng).',
      navigation: 'Nhấn thanh toán -> SCR-11.',
      notes: 'Hiển thị rõ các món bị lỗi để user xử lý trước khi tiếp tục.'
    }
  },
  { 
    id: 'SCR-11', 
    name: 'Checkout', 
    target: 'Chọn phương thức nhận hàng, áp voucher, chọn thanh toán, xác nhận đơn', 
    states: 'Loading data, Voucher applying, Order creating, Success, Fail, Store closed, Delivery unavailable, Voucher invalid, Product changed',
    detailedContent: {
      entryCondition: 'User nhấn "Thanh toán" từ Giỏ hàng.',
      uiComponents: [
        '- Selector: Pickup / Delivery.',
        '- Thông tin người nhận (Tên, SĐT, Địa chỉ).',
        '- Khu vực chọn Voucher.',
        '- Tóm tắt đơn hàng (Tiền món, Phí ship, Giảm giá, Tổng cộng).',
        '- Selector: Tiền mặt / Online.',
        '- Nút "Đặt hàng".'
      ],
      userActions: 'Nhập thông tin giao hàng, chọn voucher, chọn payment, xác nhận đặt đơn.',
      validation: 'Thông tin người nhận không rỗng, SĐT đúng định dạng, Store phải đang Open.',
      dataApi: 'API POST /orders/customer, API GET /vouchers/filter',
      uiStates: 'Loading, Order Processing, Success/Fail.',
      navigation: 'Thành công -> SCR-13. Thanh toán online -> SCR-12.',
      notes: 'Cần tính phí ship dựa trên khoảng cách nếu chọn Delivery.'
    }
  },
  { 
    id: 'SCR-12', 
    name: 'Payment QR', 
    target: 'Trung gian thanh toán online qua SePay QR hoặc web redirect', 
    states: 'Loading QR, Waiting callback, Success, Failed, Cancelled, Timeout',
    detailedContent: {
      entryCondition: 'Sau khi đặt hàng với phương thức thanh toán Online.',
      uiComponents: [
        '- Mã QR thanh toán.',
        '- Thông tin số tiền và nội dung chuyển khoản.',
        '- Countdown thời gian hiệu lực QR.',
        '- Nút "Tôi đã thanh toán".'
      ],
      userActions: 'Quét mã, nhấn xác nhận đã trả tiền.',
      validation: 'N/A (Backend xử lý callback).',
      dataApi: 'API POST /payments/sepay/qr',
      uiStates: 'Loading QR, Waiting for payment, Success, Timeout.',
      navigation: 'Thành công -> SCR-13.',
      notes: 'Cần polling API để check trạng thái thanh toán liên tục.'
    }
  },
  { 
    id: 'SCR-13', 
    name: 'Order Success', 
    target: 'Thông báo đặt hàng thành công', 
    states: 'Order created',
    detailedContent: {
      entryCondition: 'Đơn hàng được tạo thành công trên hệ thống.',
      uiComponents: [
        '- Icon thành công (Checkmark animation).',
        '- Mã đơn hàng.',
        '- Lời cảm ơn.',
        '- Nút "Về trang chủ", "Xem đơn hàng".'
      ],
      userActions: 'Nhấn nút điều hướng.',
      validation: 'N/A',
      dataApi: 'N/A',
      uiStates: 'Default.',
      navigation: 'Về Home -> SCR-04.',
      notes: 'Xóa giỏ hàng local ngay khi vào màn này.'
    }
  },
  { 
    id: 'SCR-14', 
    name: 'Profile / Account', 
    target: 'Xem thông tin tài khoản và thao tác logout', 
    states: 'Default, Logout pending, Logout success',
    detailedContent: {
      entryCondition: 'User vào tab Profile.',
      uiComponents: [
        '- Avatar, Tên, Email user.',
        '- Menu: Lịch sử đơn hàng, Voucher của tôi, Yêu thích, Cài đặt.',
        '- Nút "Đăng xuất".'
      ],
      userActions: 'Xem thông tin, nhấn Logout.',
      validation: 'N/A',
      dataApi: 'API GET /auth/me, API POST /auth/logout/customer',
      uiStates: 'Default, Loading.',
      navigation: 'Logout thành công -> SCR-02.',
      notes: 'Hiển thị phiên bản app ở cuối màn hình.'
    }
  },
  { 
    id: 'SCR-15', 
    name: 'Permission Prompt', 
    target: 'Màn giải thích quyền vị trí trước khi gọi permission OS', 
    states: 'Default',
    detailedContent: {
      entryCondition: 'User lần đầu vào màn Store Selector.',
      uiComponents: [
        '- Hình ảnh minh họa.',
        '- Text giải thích tại sao cần vị trí (để tìm store gần nhất).',
        '- Nút "Cho phép", "Để sau".'
      ],
      userActions: 'Đồng ý hoặc từ chối.',
      validation: 'N/A',
      dataApi: 'N/A',
      uiStates: 'Default.',
      navigation: 'Bấm cho phép -> Gọi Permission OS -> SCR-05.',
      notes: 'Đây là bước đệm để tăng tỷ lệ user cho phép GPS.'
    }
  },
  { 
    id: 'SCR-16', 
    name: 'Global Components', 
    target: 'Bộ state tái sử dụng: Error, Empty, Offline View Components', 
    states: 'Error, Empty, Offline',
    detailedContent: {
      entryCondition: 'Xảy ra lỗi hệ thống, không có dữ liệu hoặc mất mạng.',
      uiComponents: [
        '- Hình ảnh minh họa trạng thái.',
        '- Thông báo lỗi cụ thể.',
        '- Nút "Thử lại".'
      ],
      userActions: 'Nhấn thử lại.',
      validation: 'N/A',
      dataApi: 'N/A',
      uiStates: 'Error, Empty, Offline.',
      navigation: 'N/A',
      notes: 'Dùng chung cho toàn bộ ứng dụng để đảm bảo tính nhất quán.'
    }
  },
];

const APIS = [
  { module: 'Auth', endpoint: 'POST /auth/login/customer', purpose: 'Đăng nhập customer', status: 'Reuse' },
  { module: 'Auth', endpoint: 'POST /auth/sign-up/customer', purpose: 'Đăng ký customer', status: 'Reuse' },
  { module: 'Auth', endpoint: 'POST /auth/refresh/customer', purpose: 'Refresh session / Auto-login', status: 'Reuse' },
  { module: 'Auth', endpoint: 'POST /auth/logout/customer', purpose: 'Đăng xuất customer / Revoke token', status: 'New' },
  { module: 'Auth', endpoint: 'GET /auth/me', purpose: 'Load thông tin user profile', status: 'Reuse' },
  { module: 'Store', endpoint: 'GET /store/filter', purpose: 'Load danh sách chi nhánh (cần bổ sung lat/long)', status: 'Adjust' },
  { module: 'Store', endpoint: 'GET /store/{storeId}', purpose: 'Lấy chi tiết store / status / config', status: 'Reuse' },
  { module: 'Menu', endpoint: 'GET /product-availability/filter', purpose: 'Load menu theo availability của store', status: 'Adjust' },
  { module: 'Voucher', endpoint: 'GET /vouchers/filter', purpose: 'Load danh sách voucher (map với ID Customer)', status: 'Adjust' },
  { module: 'Voucher', endpoint: 'GET /vouchers/{voucherId}', purpose: 'Load chi tiết voucher', status: 'Reuse' },
  { module: 'Voucher', endpoint: 'GET /vouchers/code/{code}', purpose: 'Lookup voucher code thủ công', status: 'Reuse' },
  { module: 'Favorite', endpoint: 'GET /customer/favorites/products', purpose: 'Load danh sách món yêu thích', status: 'New' },
  { module: 'Favorite', endpoint: 'POST /customer/favorites/products/{productId}', purpose: 'Thêm món vào yêu thích', status: 'New' },
  { module: 'Favorite', endpoint: 'DELETE /customer/favorites/products/{productId}', purpose: 'Xóa món khỏi yêu thích', status: 'New' },
  { module: 'Cart', endpoint: 'Local Storage', purpose: 'Quản lý giỏ hàng cục bộ', status: 'Local' },
  { module: 'Cart', endpoint: 'API Revalidate Cart', purpose: 'Check lại giá và availability khi đổi store (Cần viết mới)', status: 'New' },
  { module: 'Order', endpoint: 'POST /orders/customer', purpose: 'Tạo đơn đặt hàng customer', status: 'Reuse' },
  { module: 'Order', endpoint: 'GET /orders/{orderId}', purpose: 'Lấy chi tiết đơn hàng / Polling status', status: 'Reuse' },
  { module: 'Payment', endpoint: 'POST /payments/sepay/qr', purpose: 'Tạo QR thanh toán online SePay', status: 'Reuse' },
];

const BUSINESS_RULES = [
  { group: 'Xác thực', title: 'Rule Xác thực', content: 'Customer đăng ký bằng email. Không OTP, không verify email/phone. Login bằng email/mật khẩu. App có auto login bằng refresh token. Logout phải clear token ở local và gọi API revoke token. Backend có chống rate-limit tạo account.' },
  { group: 'Chi nhánh', title: 'Rule Chọn Chi Nhánh', content: 'Customer phải chọn chi nhánh trước khi đặt hàng. Nếu có GPS thì app tự chọn chi nhánh gần nhất, nếu không thì khách tìm kiếm và chọn thủ công. Không có chi nhánh mặc định trên hệ thống. Khách hàng được đổi chi nhánh giữa chừng, và khi đổi thì giỏ hàng không bị reset.' },
  { group: 'Giỏ hàng', title: 'Rule Giỏ hàng (WF-07)', content: 'Ưu tiên lưu Local. Khi khách hàng chuyển chi nhánh trong lúc có sản phẩm tại giỏ hàng: Giỏ hàng được quét lại tự động để cập nhật tính Khả dụng (Xoá món hết) và cập nhật Giá Bán nếu có sự chênh lệch (Cập nhật và báo cho User).' },
  { group: 'Voucher', title: 'Rule Voucher', content: 'Voucher chỉ dùng để xem, áp dụng ở bước checkout, không có tính năng lưu/claim vào tài khoản. Áp dụng theo 3 cấp độ: Customer, Store, Toàn chuỗi (chain). Customer có thể nhìn thấy cả những Voucher không đủ điều kiện áp dụng. Có quy định về: min/max spend, ngày hiệu lực, giới hạn lượt dùng, không cộng dồn.' },
  { group: 'Yêu thích', title: 'Rule Favorite', content: 'Tính năng Favorite hoạt động dựa trên mapping Customer + Product (không tính size). Nếu sản phẩm trong danh sách Favorite bị set unavailable ở store đang chọn, sản phẩm đó vẫn được hiển thị trong list Favorite. Nếu sản phẩm bị chuyển trạng thái inactive khỏi hệ thống, tự động xóa sản phẩm đó khỏi tất cả các list Favorite. Danh sách Favorite được lưu trên server để đồng bộ giữa nhiều thiết bị.' },
  { group: 'NFR', title: 'Rule NFR (Phi chức năng)', content: 'API timeout sau 15s. Mất mạng -> Chặn các hành động Push Data khi mất mạng (Offline). Mọi nút submit phải có debounce 500ms. Sử dụng Skeleton Loading khi đợi load Store hoặc load Menu. Hành vi Thanh Toán/Đặt đơn phải có màn mờ Block UI chặn không cho bấm lung tung.' },
  { group: 'UI/UX', title: 'Rule UI/UX', content: 'Mọi nút thực thi Call Action từ Frontend (Login, Đăng ký, Confirm Đặt đơn) đều phải gắn block Disable UI button khi API Call is pending. Tránh việc bấm liên tục gây ra tình trạng spam gọi API tạo ra trùng lặp Giỏ hàng / Đơn hàng phía backend.' },
];

const DATA_PERMISSIONS = [
  { object: 'Auth Tokens (Access & Refresh)', guest: 'N/A', customer: 'Keychains/Secure Storage', notes: 'Bị xóa trắng khi Logout hoặc 401.' },
  { object: 'Danh sách Chi nhánh & GPS', guest: 'Chặn, nhảy ra Auth', customer: 'Toàn quyền lấy thông tin', notes: 'Public Master Data. Recommend store < 5km.' },
  { object: 'Xem Thực đơn (Availability)', guest: 'Chặn', customer: 'Truy xuất dựa trên Store ID', notes: 'Conditional Data. Trả về động theo từng Store.' },
  { object: 'Món yêu thích (Favorite)', guest: 'Chặn', customer: 'Dựa theo Customer ID trong Token', notes: 'Private Data. Backend soi Bearer Token == Owner ID.' },
  { object: 'Giỏ hàng & Order', guest: 'Chặn', customer: 'Toàn quyền', notes: 'Mọi đơn hàng tạo ra gán ID chủ sở hữu cố định.' },
  { object: 'Giỏ hàng (Cart Items)', guest: 'N/A', customer: 'App Local Storage', notes: 'Bị xóa toàn bộ khi Checkout thành công hoặc Logout.' },
  { object: 'Xem Danh sách Voucher', guest: 'Chặn', customer: 'Có Scope điều kiện cá nhân', notes: 'Cấp quyền lấy Global Voucher + Personal Voucher.' },
];

const TRACEABILITY = [
  { id: 'RQ-01', wf: 'WF-01', uc: 'UC-02', screen: 'SCR-01, SCR-02', api: 'POST /auth/login/customer', status: 'Reuse', summary: 'Customer phải đăng nhập mới dùng app' },
  { id: 'RQ-02', wf: 'WF-01', uc: 'UC-01', screen: 'SCR-03', api: 'POST /auth/sign-up/customer', status: 'Reuse', summary: 'Đăng ký bằng email, không OTP/Verify' },
  { id: 'RQ-03', wf: 'WF-01', uc: 'UC-02', screen: 'SCR-01', api: 'POST /auth/refresh/customer', status: 'Reuse', summary: 'Auto login bằng refresh token' },
  { id: 'RQ-04', wf: 'WF-01', uc: 'UC-03', screen: 'SCR-14', api: 'POST /auth/logout/customer', status: 'New', summary: 'Logout clear local & revoke token' },
  { id: 'RQ-05', wf: 'WF-02, WF-05', uc: 'UC-05', screen: 'SCR-05, SCR-15', api: 'GET /store/filter', status: 'Adjust', summary: 'Chọn store bằng GPS hoặc thủ công' },
  { id: 'RQ-06', wf: 'WF-02', uc: 'UC-05', screen: 'SCR-04, SCR-05', api: 'Local state', status: 'Local', summary: 'Không có chi nhánh mặc định' },
  { id: 'RQ-07', wf: 'WF-02', uc: 'UC-04', screen: 'SCR-04', api: 'GET /product-availability/filter', status: 'Adjust', summary: 'Menu hiển thị theo product availability' },
  { id: 'RQ-08', wf: 'WF-02', uc: 'UC-04', screen: 'SCR-04, SCR-11', api: 'GET /store/{storeId}', status: 'Reuse', summary: 'Store đóng cửa block Add to Cart/Checkout' },
  { id: 'RQ-09', wf: 'WF-03', uc: 'UC-06', screen: 'SCR-06', api: 'GET /vouchers/filter', status: 'Adjust', summary: 'Xem voucher (cả không đủ điều kiện)' },
  { id: 'RQ-10', wf: 'WF-03', uc: 'UC-06', screen: 'SCR-07', api: 'GET /vouchers/{voucherId}', status: 'Reuse', summary: 'Xem chi tiết điều kiện voucher' },
  { id: 'RQ-11', wf: 'WF-04', uc: 'UC-07', screen: 'SCR-04, SCR-09', api: 'POST /customer/favorites/products', status: 'New', summary: 'Thêm món vào yêu thích' },
  { id: 'RQ-12', wf: 'WF-04', uc: 'UC-08', screen: 'SCR-08', api: 'GET /customer/favorites/products', status: 'New', summary: 'Xem danh sách yêu thích' },
  { id: 'RQ-13', wf: 'WF-04', uc: 'UC-09', screen: 'SCR-08, SCR-09', api: 'DELETE /customer/favorites/products', status: 'New', summary: 'Bỏ món khỏi yêu thích' },
  { id: 'RQ-14', wf: 'WF-06', uc: 'UC-10', screen: 'SCR-09', api: 'GET /product/{productId}', status: 'Reuse', summary: 'Xem chi tiết món & chọn option' },
  { id: 'RQ-15', wf: 'WF-06', uc: 'UC-10', screen: 'SCR-01, SCR-10', api: 'Local Storage', status: 'Local', summary: 'Cart lưu local, giữ lại khi đóng app' },
  { id: 'RQ-16', wf: 'WF-06', uc: 'UC-10', screen: 'SCR-09, SCR-10', api: 'Local Storage', status: 'Local', summary: 'Add/update/remove item trong cart' },
  { id: 'RQ-17', wf: 'WF-07', uc: 'UC-10, UC-11', screen: 'SCR-05, SCR-10, SCR-11', api: 'GET /product-availability/filter', status: 'Adjust', summary: 'Đổi store revalidate availability & giá' },
  { id: 'RQ-18', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-10, SCR-11', api: 'Local cart flow', status: 'Local', summary: 'Checkout từ cart' },
  { id: 'RQ-19', wf: 'WF-06, WF-03', uc: 'UC-11, UC-06', screen: 'SCR-11, SCR-06, SCR-07', api: 'GET /vouchers/filter', status: 'Adjust', summary: 'Áp voucher trước khi đặt hàng' },
  { id: 'RQ-20', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-11', api: 'UI Data', status: 'Local', summary: 'Chọn phương thức nhận hàng' },
  { id: 'RQ-21', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-11', api: 'UI Data', status: 'Local', summary: 'Chọn phương thức thanh toán' },
  { id: 'RQ-22', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-11', api: 'POST /orders/customer', status: 'Reuse', summary: 'Tạo order customer từ app' },
  { id: 'RQ-23', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-12', api: 'POST /payments/sepay/qr', status: 'Reuse', summary: 'Thanh toán online SePay QR' },
  { id: 'RQ-24', wf: 'WF-06', uc: 'UC-11', screen: 'SCR-13', api: 'POST response', status: 'Reuse', summary: 'Màn đặt hàng thành công' },
  { id: 'RQ-25', wf: 'WF-01', uc: 'UC-03', screen: 'SCR-14', api: 'GET /auth/me', status: 'Reuse', summary: 'Xem thông tin tài khoản cơ bản' },
  { id: 'RQ-26', wf: 'WF-05', uc: 'UC-05', screen: 'SCR-15, SCR-05', api: 'OS Permission', status: 'Local', summary: 'Xử lý quyền vị trí & fallback' },
  { id: 'RQ-27', wf: 'Tất cả', uc: 'Tất cả', screen: 'Tất cả', api: 'UI Logic', status: 'Local', summary: 'Chặn double submit, loading/error states' },
];

const VALIDATIONS = [
  { screen: 'Login', field: 'Email', type: 'Text', required: 'Có', rule: 'Email format', error: 'Email không hợp lệ' },
  { screen: 'Login', field: 'Password', type: 'Password', required: 'Có', rule: 'Không rỗng', error: 'Vui lòng nhập mật khẩu' },
  { screen: 'Register', field: 'Email', type: 'Text', required: 'Có', rule: 'Email format', error: 'Email không hợp lệ' },
  { screen: 'Register', field: 'Password', type: 'Password', required: 'Có', rule: 'Tối thiểu 8 ký tự', error: 'Mật khẩu không hợp lệ' },
  { screen: 'Register', field: 'Confirm Password', type: 'Password', required: 'Có', rule: 'Phải khớp password', error: 'Mật khẩu xác nhận không khớp' },
  { screen: 'Product Detail', field: 'Size', type: 'Option', required: 'Tùy món', rule: 'Bắt buộc nếu là mandatory', error: 'Vui lòng chọn size' },
  { screen: 'Product Detail', field: 'Topping', type: 'Multi-select', required: 'Không', rule: 'Theo rule min/max', error: 'Topping không hợp lệ' },
  { screen: 'Product Detail', field: 'Quantity', type: 'Number', required: 'Có', rule: '>= 1', error: 'Số lượng không hợp lệ' },
  { screen: 'Checkout', field: 'Fulfillment type', type: 'Radio', required: 'Có', rule: 'Phải chọn 1', error: 'Vui lòng chọn hình thức nhận hàng' },
  { screen: 'Checkout', field: 'Payment method', type: 'Radio', required: 'Có', rule: 'Phải chọn 1', error: 'Vui lòng chọn phương thức thanh toán' },
];

// --- Components ---

const Badge = ({ status }: { status: string }) => {
  const getStyles = () => {
    const s = status.toLowerCase();
    if (s.includes('new')) return 'bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/30 dark:text-rose-400 dark:border-rose-800';
    if (s.includes('reuse')) return 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800';
    if (s.includes('local')) return 'bg-slate-100 text-gray-900 border-slate-200 dark:bg-slate-800 dark:text-gray-100 dark:border-slate-700';
    if (s.includes('adjust')) return 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800';
    return 'bg-gray-100 text-gray-900 border-gray-200 dark:bg-gray-800 dark:text-gray-100 dark:border-gray-700';
  };

  return (
    <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider border ${getStyles()}`}>
      {status}
    </span>
  );
};

export default function App() {
  const [darkMode, setDarkMode] = useState(true);
  const [activeTab, setActiveTab] = useState('use-cases');
  const [globalSearch, setGlobalSearch] = useState('');
  const [apiStatusFilter, setApiStatusFilter] = useState('Tất cả');
  const [apiFeatureFilter, setApiFeatureFilter] = useState('Tất cả');

  const [panelStack, setPanelStack] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Firebase & Project State
  const [user, setUser] = useState<User | null>(null);
  const [projects, setProjects] = useState<any[]>([]);
  const [currentProject, setCurrentProject] = useState<any>(null);
  const [versions, setVersions] = useState<any[]>([]);
  const [currentVersion, setCurrentVersion] = useState<any>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isVersionMenuOpen, setIsVersionMenuOpen] = useState(false);
  const [isAuthReady, setIsAuthReady] = useState(false);

  // Local Data (Fallback if no project selected)
  const [localData] = useState<any>({
    useCases: USE_CASES,
    workflows: WORKFLOWS,
    screens: SCREENS,
    apiEndpoints: APIS,
    businessRules: BUSINESS_RULES,
    permissions: DATA_PERMISSIONS,
    traceability: TRACEABILITY,
    validation: VALIDATIONS
  });

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setIsAuthReady(true);
      if (u) {
        fetchProjects();
      } else {
        setProjects([]);
        setCurrentProject(null);
      }
    });
    return () => unsubscribe();
  }, []);

  const fetchProjects = async () => {
    const q = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
    const snapshot = await getDocs(q);
    const projs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    setProjects(projs);
    if (projs.length > 0 && !currentProject) {
      setCurrentProject(projs[0]);
    }
  };

  useEffect(() => {
    if (currentProject) {
      const unsubscribe = onSnapshot(
        query(collection(db, `projects/${currentProject.id}/versions`), orderBy('createdAt', 'desc')),
        (snapshot) => {
          const vers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
          setVersions(vers);
          if (vers.length > 0) {
            setCurrentVersion(vers[0]);
          } else {
            setCurrentVersion(null);
          }
        }
      );
      return () => unsubscribe();
    }
  }, [currentProject]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  const handleLogout = () => signOut(auth);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !user) return;

    setIsUploading(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result as string;
      await processBADocument(text, file.name);
    };
    reader.readAsText(file);
  };

  const processBADocument = async (content: string, fileName: string) => {
    try {
      const prompt = `
        You are a Senior BA and System Architect. I will provide you with a BA document content.
        Your task is to parse this content and structure it into a PRD format.
        
        The output MUST be a JSON object with the following structure:
        {
          "appName": "Name of the app",
          "appDescription": "Description of the app",
          "data": {
            "useCases": [...],
            "workflows": [...],
            "screens": [...],
            "apiEndpoints": [...],
            "businessRules": [...],
            "permissions": [...],
            "traceability": [...],
            "validation": [...]
          }
        }
        
        Use the existing PRD structure as a reference for the fields in each array.
        If the document is for a different app than the current one, I will create a new project.
        
        BA Document Content:
        ${content}
      `;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              appName: { type: Type.STRING },
              appDescription: { type: Type.STRING },
              data: {
                type: Type.OBJECT,
                properties: {
                  useCases: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  workflows: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  screens: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  apiEndpoints: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  businessRules: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  permissions: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  traceability: { type: Type.ARRAY, items: { type: Type.OBJECT } },
                  validation: { type: Type.ARRAY, items: { type: Type.OBJECT } }
                }
              }
            }
          }
        }
      });

      const result = JSON.parse(response.text);
      
      // Check if project exists or create new
      let projectId = currentProject?.id;
      let isNewProject = false;
      
      // Simple check: if appName is significantly different, create new project
      if (!projectId || (result.appName && result.appName.toLowerCase() !== currentProject.name.toLowerCase())) {
        const projectRef = await addDoc(collection(db, 'projects'), {
          name: result.appName || "New Project",
          description: result.appDescription || "",
          createdAt: serverTimestamp()
        });
        projectId = projectRef.id;
        isNewProject = true;
      }

      // Add new version
      await addDoc(collection(db, `projects/${projectId}/versions`), {
        projectId,
        notes: `Imported from ${fileName}`,
        createdAt: serverTimestamp(),
        data: result.data
      });

      if (isNewProject) {
        fetchProjects();
      }

      setIsUploading(false);
      alert("PRD generated and saved successfully!");
    } catch (error) {
      console.error("AI Processing failed:", error);
      setIsUploading(false);
      alert("Failed to process document. Please try again.");
    }
  };

  const displayData = currentVersion?.data || localData;

  const filterData = (data: any[]) => {
    if (!globalSearch) return data;
    const lowerSearch = globalSearch.toLowerCase();
    
    const searchInObject = (obj: any): boolean => {
      if (!obj) return false;
      return Object.values(obj).some(val => {
        if (typeof val === 'string' || typeof val === 'number') {
          return String(val).toLowerCase().includes(lowerSearch);
        }
        if (Array.isArray(val)) {
          return val.some(item => String(item).toLowerCase().includes(lowerSearch));
        }
        if (typeof val === 'object') {
          return searchInObject(val);
        }
        return false;
      });
    };

    return data.filter(item => searchInObject(item));
  };

  const filteredUseCases = useMemo(() => filterData(displayData.useCases), [displayData.useCases, globalSearch]);
  const filteredWorkflows = useMemo(() => filterData(displayData.workflows), [displayData.workflows, globalSearch]);
  const filteredScreens = useMemo(() => filterData(displayData.screens), [displayData.screens, globalSearch]);
  const filteredAPIs = useMemo(() => {
    let data = filterData(displayData.apiEndpoints);
    if (apiStatusFilter !== 'Tất cả') {
      data = data.filter((api: any) => api.status === apiStatusFilter);
    }
    if (apiFeatureFilter !== 'Tất cả') {
      data = data.filter((api: any) => api.purpose === apiFeatureFilter);
    }
    return data;
  }, [displayData.apiEndpoints, globalSearch, apiStatusFilter, apiFeatureFilter]);

  const uniqueFeatures = useMemo(() => {
    const features = displayData.apiEndpoints.map((api: any) => api.purpose);
    return ['Tất cả', ...new Set(features)].sort();
  }, [displayData.apiEndpoints]);
  const filteredRules = useMemo(() => filterData(displayData.businessRules), [displayData.businessRules, globalSearch]);
  const filteredPermissions = useMemo(() => filterData(displayData.permissions), [displayData.permissions, globalSearch]);
  const filteredTraceability = useMemo(() => filterData(displayData.traceability), [displayData.traceability, globalSearch]);
  const filteredValidations = useMemo(() => filterData(displayData.validation), [displayData.validation, globalSearch]);

  useEffect(() => {
    if (scrollContainerRef.current) {
      // Small delay to allow layout to update before scrolling
      setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({
            left: scrollContainerRef.current.scrollWidth,
            behavior: 'smooth'
          });
        }
      }, 50);
    }
  }, [panelStack]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenPanel = (item: any) => {
    setPanelStack(prev => {
      if (prev.length > 0 && prev[prev.length - 1].id === item.id && item.id) {
         return prev;
      }
      const newStack = [...prev, item];
      if (newStack.length > 3) {
        return newStack.slice(newStack.length - 3);
      }
      return newStack;
    });
  };

  const closePanel = (index: number) => {
    setPanelStack(prev => prev.slice(0, index));
  };

  const closeAllPanels = () => {
    setPanelStack([]);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPanelStack(prev => {
          if (prev.length > 0) {
            return prev.slice(0, prev.length - 1);
          }
          return prev;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleOpenModalById = (id: string) => {
    let item = null;
    if (id.startsWith('UC-')) {
      item = displayData.useCases.find((u: any) => u.id === id);
      if (item) item = { ...item, type: 'uc' };
    } else if (id.startsWith('SCR-')) {
      item = displayData.screens.find((s: any) => s.id === id);
      if (item) item = { ...item, type: 'scr' };
    } else if (id.startsWith('WF-')) {
      item = displayData.workflows.find((w: any) => w.id === id);
      if (item) item = { ...item, type: 'wf' };
    }
    
    if (item) {
      handleOpenPanel(item);
    }
  };

  const renderTextWithLinks = (text: string) => {
    if (!text) return text;
    const regex = /(SCR-\d{2}|UC-\d{2}|WF-\d{2})/g;
    const parts = text.split(regex);
    
    return parts.map((part, index) => {
      if (part.match(/^(SCR-\d{2}|UC-\d{2}|WF-\d{2})$/)) {
        return (
          <span 
            key={index} 
            onClick={(e) => {
              e.stopPropagation();
              handleOpenModalById(part);
            }}
            className="text-blue-600 dark:text-blue-400 font-semibold cursor-pointer hover:underline"
          >
            {part}
          </span>
        );
      }
      return part;
    });
  };

  const cleanText = (text: string) => {
    if (!text) return '';
    return text.replace(/^(\d+[a-zA-Z]?\.?|\-|\•|\*)\s*/, '');
  };

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  const tabs = [
    { id: 'use-cases', label: 'Use Cases', icon: ClipboardList },
    { id: 'workflows', label: 'Workflows', icon: Activity },
    { id: 'screens', label: 'Screens & UI', icon: Smartphone },
    { id: 'apis', label: 'Ma trận API', icon: Zap },
    { id: 'rules', label: 'Business Rules', icon: ShieldCheck },
    { id: 'permissions', label: 'Phân quyền & Data', icon: Database },
    { id: 'traceability', label: 'Traceability & Validation', icon: CheckSquare },
  ];

  const handleExport = () => {
    const generateCSV = (data: any[], headers: string[]) => {
      if (data.length === 0) return "";
      const keys = Object.keys(data[0]);
      return [
        headers.join(','),
        ...data.map(row => 
          keys.map(key => {
            const cell = row[key] === null || row[key] === undefined ? '' : String(row[key]);
            return `"${cell.replace(/"/g, '""')}"`;
          }).join(',')
        )
      ].join('\n');
    };

    const downloadCSV = (content: string, filename: string) => {
      const blob = new Blob(["\ufeff" + content], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${filename}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    };

    let csvContent = "";
    let filename = `PRD_${activeTab}_${new Date().toISOString().split('T')[0]}`;

    switch (activeTab) {
      case 'use-cases': 
        csvContent = generateCSV(filteredUseCases, ['Mã UC', 'Tên Use Case', 'Mục tiêu', 'Logic', 'Trạng thái']); 
        break;
      case 'screens': 
        csvContent = generateCSV(filteredScreens, ['Mã Màn hình', 'Tên Màn hình', 'Mục tiêu', 'UI States']); 
        break;
      case 'apis': 
        csvContent = generateCSV(filteredAPIs, ['Phân hệ', 'Endpoint', 'Mục đích', 'Trạng thái']); 
        break;
      case 'rules': 
        csvContent = generateCSV(filteredRules, ['Nhóm', 'Tiêu đề', 'Nội dung']); 
        break;
      case 'permissions': 
        csvContent = generateCSV(filteredPermissions, ['Object', 'Guest', 'Customer', 'Notes']); 
        break;
      case 'traceability': 
        const traceCSV = generateCSV(filteredTraceability, ['RQ ID', 'Workflow', 'Use Case', 'Screen', 'API', 'Status', 'Summary']);
        const validCSV = generateCSV(filteredValidations, ['Screen', 'Field', 'Type', 'Required', 'Rule', 'Error']);
        csvContent = "TRACEABILITY MATRIX\n" + traceCSV + "\n\nFIELD VALIDATION MATRIX\n" + validCSV;
        break;
      default: return;
    }

    if (csvContent) {
      downloadCSV(csvContent, filename);
    }
  };

  return (
    <div className={`min-h-screen transition-colors duration-300 ${darkMode ? 'bg-slate-950 text-gray-100' : 'bg-slate-50 text-gray-900'}`}>
      {/* Header */}
      <header className={`sticky top-0 z-40 border-b transition-colors duration-300 ${darkMode ? 'bg-slate-900/80 border-gray-700' : 'bg-slate-50/80 border-gray-200'} backdrop-blur-md`}>
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 shrink-0">
            <div className="bg-indigo-600 p-1.5 rounded-lg shadow-lg shadow-indigo-500/20">
              <Layout className="w-5 h-5 text-white" />
            </div>
            <div className="hidden sm:block">
              <h1 className="text-sm font-bold tracking-tight text-black dark:text-white leading-tight">
                PRD Master Dashboard
              </h1>
              <p className="text-[10px] font-medium text-indigo-500 uppercase tracking-wider">
                {currentProject?.name || "F&B Mobile App"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4 flex-1 justify-end">
            {!isAuthReady ? (
              <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            ) : user ? (
              <>
                {/* Project Selector */}
                <div className="flex items-center gap-2">
                  <span className="hidden xl:inline text-[10px] font-bold text-gray-500 uppercase tracking-wider">Project:</span>
                  <div className="relative">
                    <button 
                      onClick={() => { setIsProjectMenuOpen(!isProjectMenuOpen); setIsVersionMenuOpen(false); }}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                        darkMode ? 'bg-slate-800 border-gray-700 text-white hover:bg-slate-700' : 'bg-slate-100 border-gray-200 text-black hover:bg-slate-200'
                      } border shadow-sm`}
                    >
                      <ClipboardList className="w-3.5 h-3.5 text-indigo-500" />
                      <span>{currentProject?.name || "F&B Mobile App"}</span>
                    </button>
                    {isProjectMenuOpen && (
                      <div className={`absolute top-full right-0 mt-2 w-64 rounded-xl border shadow-xl z-50 overflow-hidden ${darkMode ? 'bg-slate-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                        <div className="p-2 max-h-60 overflow-y-auto">
                          <button
                            onClick={() => { setCurrentProject(null); setIsProjectMenuOpen(false); }}
                            className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors mb-1 ${
                              currentProject === null 
                                ? 'bg-indigo-500 text-white' 
                                : darkMode ? 'hover:bg-slate-800 text-gray-300' : 'hover:bg-slate-100 text-gray-700'
                            }`}
                          >
                            F&B Mobile App (Mặc định)
                          </button>
                          {projects.length > 0 && <div className="h-px bg-gray-200 dark:bg-gray-700 my-1 mx-2" />}
                          {projects.map(p => (
                            <button
                              key={p.id}
                              onClick={() => { setCurrentProject(p); setIsProjectMenuOpen(false); }}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                                currentProject?.id === p.id 
                                  ? 'bg-indigo-500 text-white' 
                                  : darkMode ? 'hover:bg-slate-800 text-gray-300' : 'hover:bg-slate-100 text-gray-700'
                              }`}
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Version Selector */}
                {currentProject && (
                  <div className="flex items-center gap-2">
                    <span className="hidden xl:inline text-[10px] font-bold text-gray-500 uppercase tracking-wider">Versioning:</span>
                    <div className="relative">
                      <button 
                        onClick={() => { setIsVersionMenuOpen(!isVersionMenuOpen); setIsProjectMenuOpen(false); }}
                        className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          darkMode ? 'bg-slate-800 border-gray-700 text-white hover:bg-slate-700' : 'bg-slate-100 border-gray-200 text-black hover:bg-slate-200'
                        } border shadow-sm`}
                      >
                        <History className="w-3.5 h-3.5 text-indigo-500" />
                        <span>{currentVersion ? `Version: ${new Date(currentVersion.createdAt?.toDate()).toLocaleDateString('vi-VN')}` : "Versioning"}</span>
                      </button>
                      {isVersionMenuOpen && (
                        <div className={`absolute top-full right-0 mt-2 w-64 rounded-xl border shadow-xl z-50 overflow-hidden ${darkMode ? 'bg-slate-900 border-gray-700' : 'bg-white border-gray-200'}`}>
                          <div className="p-2 max-h-60 overflow-y-auto">
                            {versions.map(v => (
                              <button
                                key={v.id}
                                onClick={() => { setCurrentVersion(v); setIsVersionMenuOpen(false); }}
                                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors ${
                                  currentVersion?.id === v.id 
                                    ? 'bg-indigo-500 text-white' 
                                    : darkMode ? 'hover:bg-slate-800 text-gray-300' : 'hover:bg-slate-100 text-gray-700'
                                }`}
                              >
                                <div className="font-bold">{new Date(v.createdAt?.toDate()).toLocaleString('vi-VN')}</div>
                                <div className="text-[10px] opacity-70 truncate">{v.notes}</div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Upload Button */}
                <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-all ${
                  darkMode ? 'bg-indigo-600 hover:bg-indigo-500 text-white' : 'bg-indigo-500 hover:bg-indigo-400 text-white'
                } shadow-sm shadow-indigo-500/20`}>
                  {isUploading ? <Activity className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5 rotate-180" />}
                  <span className="hidden lg:inline">{isUploading ? "Đang xử lý..." : "Upload BA"}</span>
                  <input type="file" className="hidden" onChange={handleFileUpload} accept=".txt,.md,.doc,.docx" disabled={isUploading} />
                </label>

                <button 
                  onClick={handleLogout}
                  className={`p-2 rounded-full border transition-all ${
                    darkMode ? 'bg-slate-800 border-gray-700 text-gray-400 hover:text-white' : 'bg-slate-100 border-gray-200 text-gray-600 hover:text-black'
                  }`}
                  title="Đăng xuất"
                >
                  <X className="w-4 h-4" />
                </button>
              </>
            ) : (
              <button 
                onClick={handleLogin}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20`}
              >
                <Lock className="w-4 h-4" />
                Đăng nhập
              </button>
            )}

            <div className="h-6 w-px bg-gray-200 dark:bg-gray-700 mx-1 hidden sm:block" />

            <button 
              onClick={handleExport}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                darkMode ? 'bg-slate-800 border-gray-700 text-white hover:bg-slate-700' : 'bg-white border-gray-200 text-black hover:bg-gray-50'
              } border shadow-sm`}
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden lg:inline">Xuất CSV</span>
            </button>

            <div className="relative w-full max-w-[200px] group hidden md:block">
              <Search className={`absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 transition-colors ${darkMode ? 'text-gray-400 group-focus-within:text-indigo-400' : 'text-gray-500 group-focus-within:text-indigo-500'}`} />
              <input 
                type="text" 
                placeholder="Tìm kiếm..."
                className={`w-full pl-9 pr-4 py-1.5 rounded-full text-xs outline-none border transition-all ${
                  darkMode 
                    ? 'bg-slate-800 border-gray-700 focus:border-indigo-500 text-gray-100' 
                    : 'bg-slate-100 border-gray-200 focus:border-indigo-500 text-gray-900'
                }`}
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </div>

            <button 
              onClick={() => setDarkMode(!darkMode)}
              className={`p-2 rounded-full border transition-all ${
                darkMode ? 'bg-slate-800 border-gray-700 text-yellow-400' : 'bg-slate-100 border-gray-200 text-gray-900'
              }`}
            >
              {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-4 sm:p-6">
        {/* Navigation Tabs */}
        <div className="flex overflow-x-auto no-scrollbar gap-1 mb-8 p-1 rounded-xl bg-slate-200/50 dark:bg-slate-900/50 w-fit max-w-full border border-gray-200 dark:border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-sm'
                  : 'text-gray-900 dark:text-gray-100 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content Area */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
            className={`rounded-2xl border shadow-sm overflow-hidden transition-colors ${darkMode ? 'bg-slate-900 border-gray-700' : 'bg-slate-50 border-gray-200'}`}
          >
            {/* Tab 1: Use Cases */}
            {activeTab === 'use-cases' && (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Mã UC</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-48">Tên Use Case</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[400px]">Mục tiêu & Logic</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white text-right">Backend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredUseCases.map((uc) => (
                      <tr 
                        key={uc.id} 
                        onClick={() => handleOpenPanel({ ...uc, type: 'uc' })}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                      >
                        <td className="p-4 align-top font-mono text-xs font-bold text-indigo-500">{renderTextWithLinks(uc.id)}</td>
                        <td className="p-4 align-top font-semibold text-sm whitespace-normal break-words text-gray-900 dark:text-gray-100">{renderTextWithLinks(uc.name)}</td>
                        <td className="p-4 align-top">
                          <p className="text-sm font-medium mb-1 whitespace-normal break-words leading-relaxed text-gray-900 dark:text-gray-100">{renderTextWithLinks(uc.goal)}</p>
                          <p className="text-xs text-gray-900 dark:text-gray-100 italic whitespace-normal break-words leading-relaxed">{renderTextWithLinks(uc.logic)}</p>
                        </td>
                        <td className="p-4 align-top text-right"><Badge status={uc.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 1.5: Workflows */}
            {activeTab === 'workflows' && (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Mã WF</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-48">Tên Workflow</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[400px]">Mục tiêu</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white text-right">Backend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredWorkflows.map((wf) => (
                      <tr 
                        key={wf.id} 
                        onClick={() => handleOpenPanel({ ...wf, type: 'wf' })}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                      >
                        <td className="p-4 align-top font-mono text-xs font-bold text-indigo-500">{renderTextWithLinks(wf.id)}</td>
                        <td className="p-4 align-top font-semibold text-sm whitespace-normal break-words text-gray-900 dark:text-gray-100">{renderTextWithLinks(wf.name)}</td>
                        <td className="p-4 align-top">
                          <p className="text-sm font-medium mb-1 whitespace-normal break-words leading-relaxed text-gray-900 dark:text-gray-100">{renderTextWithLinks(wf.goal)}</p>
                        </td>
                        <td className="p-4 align-top text-right"><Badge status={wf.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 2: Screens & UI */}
            {activeTab === 'screens' && (
              <div className="overflow-x-auto w-full">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-32">Mã Màn hình</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-48">Tên Màn hình</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[300px]">Mục tiêu / UI Logic</th>
                      <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[200px]">UI States</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredScreens.map((s) => (
                      <tr 
                        key={s.id} 
                        onClick={() => handleOpenPanel({ ...s, type: 'scr' })}
                        className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                      >
                        <td className="p-4 align-top font-mono text-xs font-bold text-indigo-500">{renderTextWithLinks(s.id)}</td>
                        <td className="p-4 align-top font-semibold text-sm whitespace-normal break-words text-gray-900 dark:text-gray-100">{renderTextWithLinks(s.name)}</td>
                        <td className="p-4 align-top text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-normal break-words">{renderTextWithLinks(s.target)}</td>
                        <td className="p-4 align-top">
                          <div className="flex flex-wrap gap-1">
                            {s.states.split(', ').map(st => (
                              <span key={st} className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 whitespace-normal break-words">{st}</span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Tab 3: Ma trận API */}
            {activeTab === 'apis' && (
              <div className="p-0">
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 flex flex-wrap items-center justify-between gap-4">
                  <h2 className="text-sm font-semibold flex items-center gap-2 text-black dark:text-white">
                    <Activity className="w-4 h-4 text-indigo-500" />
                    Hệ thống API Endpoints
                  </h2>
                  <div className="flex flex-wrap items-center gap-4">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase text-black dark:text-white">Trạng thái:</span>
                      <select 
                        className={`text-xs px-2 py-1 rounded border outline-none ${darkMode ? 'bg-slate-800 border-gray-700 text-gray-100' : 'bg-slate-50 border-gray-200 text-gray-900'}`}
                        value={apiStatusFilter}
                        onChange={(e) => setApiStatusFilter(e.target.value)}
                      >
                        <option value="Tất cả">Tất cả</option>
                        <option value="New">New</option>
                        <option value="Reuse">Reuse</option>
                        <option value="Adjust">Adjust</option>
                        <option value="Local">Local</option>
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-semibold uppercase text-black dark:text-white">Tính năng:</span>
                      <select 
                        className={`text-xs px-2 py-1 rounded border outline-none ${darkMode ? 'bg-slate-800 border-gray-700 text-gray-100' : 'bg-slate-50 border-gray-200 text-gray-900'}`}
                        value={apiFeatureFilter}
                        onChange={(e) => setApiFeatureFilter(e.target.value)}
                      >
                        {uniqueFeatures.map(feature => (
                          <option key={feature} value={feature}>{feature}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="overflow-x-auto w-full">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                        <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Phân hệ</th>
                        <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[300px]">API Endpoint</th>
                        <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[300px]">Mục đích</th>
                        <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white text-right">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {filteredAPIs.map((api, idx) => (
                        <tr 
                          key={idx} 
                          onClick={() => handleOpenPanel({ ...api, type: 'api' })}
                          className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                        >
                          <td className="p-4 align-top font-semibold text-xs text-gray-900 dark:text-gray-100">{renderTextWithLinks(api.module)}</td>
                          <td className="p-4 align-top">
                            <code className={`px-2 py-1 rounded text-[11px] font-mono whitespace-normal break-all ${darkMode ? 'bg-slate-800 text-indigo-400' : 'bg-indigo-50 text-indigo-700'}`}>
                              {api.endpoint}
                            </code>
                          </td>
                          <td className="p-4 align-top text-sm text-gray-900 dark:text-gray-100 whitespace-normal break-words leading-relaxed">{renderTextWithLinks(api.purpose)}</td>
                          <td className="p-4 align-top text-right"><Badge status={api.status} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Tab 4: Business Rules */}
            {activeTab === 'rules' && (
              <div className="p-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredRules.map((rule, idx) => (
                    <motion.div 
                      key={idx}
                      whileHover={{ y: -4 }}
                      onClick={() => handleOpenPanel({ ...rule, type: 'rule' })}
                      className={`p-6 rounded-2xl border transition-all group cursor-pointer flex flex-col justify-between ${
                        darkMode ? 'bg-gray-800 border-gray-700 hover:bg-gray-700' : 'bg-white border-gray-200 hover:bg-gray-50 hover:shadow-xl hover:shadow-indigo-500/10'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-[10px] font-semibold uppercase tracking-widest text-indigo-500">{rule.group}</span>
                        <div className="bg-indigo-500/10 p-1.5 rounded-lg">
                          <ShieldCheck className="w-4 h-4 text-indigo-500" />
                        </div>
                      </div>
                      <h3 className="font-semibold text-sm tracking-tight mb-3 text-black dark:text-white">{renderTextWithLinks(rule.title)}</h3>
                      <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">
                        {renderTextWithLinks(rule.content)}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}



            {/* Tab 6: Traceability & Validation */}
            {activeTab === 'traceability' && (
              <div className="p-0">
                <div className="p-6 border-b border-gray-200 dark:border-gray-700">
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-4 text-black dark:text-white">
                    <FileText className="w-4 h-4 text-indigo-500" />
                    Traceability Matrix (RQ-xx)
                  </h2>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white w-20">RQ ID</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Workflow</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Use Case</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white w-32">Screen</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[200px]">API / Source</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Status</th>
                          <th className="p-4 align-top text-[10px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[300px]">Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredTraceability.map((item) => (
                          <tr 
                            key={item.id} 
                            onClick={() => handleOpenPanel({ ...item, type: 'traceability' })}
                            className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                          >
                            <td className="p-4 align-top font-mono text-[10px] font-bold text-indigo-500">{item.id}</td>
                            <td className="p-4 align-top text-[11px] text-gray-900 dark:text-gray-100 whitespace-normal break-words">{renderTextWithLinks(item.wf)}</td>
                            <td className="p-4 align-top text-[11px] text-gray-900 dark:text-gray-100 font-semibold whitespace-normal break-words">{renderTextWithLinks(item.uc)}</td>
                            <td className="p-4 align-top text-[11px] text-gray-900 dark:text-gray-100 whitespace-normal break-words">{renderTextWithLinks(item.screen)}</td>
                            <td className="p-4 align-top text-[11px] font-mono text-indigo-400 whitespace-normal break-all">{item.api}</td>
                            <td className="p-4 align-top"><Badge status={item.status} /></td>
                            <td className="p-4 align-top text-[11px] font-semibold text-gray-900 dark:text-gray-100 whitespace-normal break-words leading-relaxed">{renderTextWithLinks(item.summary)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="p-6">
                  <h2 className="text-sm font-semibold flex items-center gap-2 mb-4 text-black dark:text-white">
                    <CheckSquare className="w-4 h-4 text-indigo-500" />
                    Field Validation Matrix
                  </h2>
                  <div className="overflow-x-auto w-full">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className={`${darkMode ? 'bg-slate-800/50' : 'bg-slate-50'}`}>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-32">Screen</th>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-32">Field</th>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Type</th>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white w-24">Required</th>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[200px]">Rule</th>
                          <th className="p-4 align-top text-[11px] font-semibold uppercase tracking-wider text-black dark:text-white min-w-[200px]">Error Message</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                        {filteredValidations.map((item, idx) => (
                          <tr 
                            key={idx} 
                            onClick={() => handleOpenPanel({ ...item, type: 'validation' })}
                            className={`hover:bg-slate-50/50 dark:hover:bg-slate-800/50 transition-colors group cursor-pointer ${darkMode ? 'odd:bg-gray-800 even:bg-gray-900' : 'odd:bg-slate-50 even:bg-slate-100/50'}`}
                          >
                            <td className="p-4 align-top font-semibold text-xs text-gray-900 dark:text-gray-100 whitespace-normal break-words">{renderTextWithLinks(item.screen)}</td>
                            <td className="p-4 align-top font-semibold text-sm whitespace-normal break-words text-gray-900 dark:text-gray-100">{renderTextWithLinks(item.field)}</td>
                            <td className="p-4 align-top text-xs text-gray-900 dark:text-gray-100 whitespace-normal break-words">{renderTextWithLinks(item.type)}</td>
                            <td className="p-4 align-top text-xs font-semibold text-indigo-500 whitespace-normal break-words">{renderTextWithLinks(item.required)}</td>
                            <td className="p-4 align-top text-sm text-gray-900 dark:text-gray-100 whitespace-normal break-words leading-relaxed">{renderTextWithLinks(item.rule)}</td>
                            <td className="p-4 align-top text-xs text-rose-500 italic whitespace-normal break-words leading-relaxed">{renderTextWithLinks(item.error)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {/* Empty State */}
            {((activeTab === 'use-cases' && filteredUseCases.length === 0) ||
              (activeTab === 'screens' && filteredScreens.length === 0) ||
              (activeTab === 'apis' && filteredAPIs.length === 0) ||
              (activeTab === 'rules' && filteredRules.length === 0) ||
              (activeTab === 'permissions' && filteredPermissions.length === 0) ||
              (activeTab === 'traceability' && filteredTraceability.length === 0)) && (
              <div className="py-20 text-center">
                <div className="bg-slate-100 dark:bg-slate-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Search className="w-8 h-8 text-gray-900 dark:text-gray-100" />
                </div>
                <h3 className="text-lg font-semibold mb-1 text-black dark:text-white">Không tìm thấy kết quả</h3>
                <p className="text-sm text-gray-900 dark:text-gray-100">Vui lòng thử lại với từ khóa khác hoặc điều chỉnh bộ lọc.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

                                        {/* Cascading Panels */}
        <AnimatePresence>
          {panelStack.length > 0 && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 flex bg-black/20 backdrop-blur-sm overflow-x-auto overflow-y-hidden custom-scrollbar"
              ref={scrollContainerRef}
            >
              {/* Overlay click to close all */}
              <div className="fixed inset-0" onClick={closeAllPanels} />
              
              <div className="relative flex h-full pointer-events-none items-stretch min-w-full">
                <AnimatePresence mode="popLayout">
                  {panelStack.map((panelItem, index) => {
                    return (
                      <motion.div
                        layout
                        key={`${panelItem.id || panelItem.name || index}-${index}`}
                        initial={{ x: '100%', opacity: 0 }}
                        animate={{ x: 0, opacity: 1 }}
                        exit={{ x: '100%', opacity: 0 }}
                        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                        style={{ 
                          width: 'min(600px, 90vw)'
                        }}
                        className={`h-full border-l shadow-2xl flex flex-col shrink-0 pointer-events-auto ${index === 0 ? 'ml-auto' : ''} ${darkMode ? 'bg-gray-900 border-gray-700' : 'bg-slate-50 border-gray-200'}`}
                      >
                        {/* Panel Header */}
                        <div className={`flex items-center justify-between p-4 border-b shrink-0 ${darkMode ? 'border-gray-700 bg-slate-800/50' : 'border-gray-200 bg-slate-50'}`}>
                          <div className="flex items-center gap-3 overflow-hidden">
                            {(panelItem.id || panelItem.module || panelItem.group) && (
                              <span className="px-2 py-1 rounded bg-indigo-500 text-white text-xs font-bold font-mono shrink-0">
                                {panelItem.id || panelItem.module || panelItem.group || 'INFO'}
                              </span>
                            )}
                            <h2 className="text-lg font-bold text-gray-900 dark:text-white truncate">
                              {panelItem.name || panelItem.endpoint || panelItem.title || panelItem.object || panelItem.summary || panelItem.field}
                            </h2>
                          </div>
                          <div className="flex items-center gap-2 shrink-0 ml-4">
                            <button 
                              onClick={() => copyToClipboard(JSON.stringify(panelItem, null, 2))}
                              className={`p-2 rounded-full transition-all ${darkMode ? 'hover:bg-gray-700 text-gray-100' : 'hover:bg-gray-200 text-gray-900'}`}
                              title="Copy JSON Data"
                            >
                              {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                            </button>
                            <button 
                              onClick={() => closePanel(index)}
                              className={`p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors ${darkMode ? 'text-gray-100' : 'text-gray-900'}`}
                            >
                              <X className="w-5 h-5" />
                            </button>
                          </div>
                        </div>

{/* Modal Body */}
                <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                  {(panelItem.type === 'uc' || panelItem.type === 'wf') && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Info className="w-4 h-4" /> Thông tin cơ bản
                        </h3>
                        <div className="flex flex-col md:flex-row gap-4 items-start">
                          <div className={`flex-1 p-3 rounded-lg border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Mục tiêu:</p>
                            <p className="text-sm text-gray-900 dark:text-gray-100">{renderTextWithLinks(panelItem.goal)}</p>
                          </div>
                          <div className={`w-full md:w-auto md:min-w-[180px] p-3 rounded-lg border shrink-0 ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Trạng thái Backend:</p>
                            <div className="mt-1">
                              <Badge status={panelItem.status} />
                            </div>
                          </div>
                        </div>
                      </section>

                      {panelItem.detailedContent ? (
                        <div className="space-y-6">
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <ChevronRight className="w-4 h-4 text-indigo-500" /> Tiền điều kiện:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.preCondition)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Zap className="w-4 h-4 text-amber-500" /> Kích hoạt:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.trigger)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-emerald-500" /> Luồng chính:
                            </h4>
                            <ul className="list-decimal pl-10 space-y-2">
                              {panelItem.detailedContent.mainFlow.map((step: string, i: number) => (
                                <li key={i} className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(cleanText(step))}</li>
                              ))}
                            </ul>
                          </section>
                          {panelItem.detailedContent.exceptionFlow && (
                            <section>
                              <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                                <AlertCircle className="w-4 h-4 text-rose-500" /> Luồng ngoại lệ:
                              </h4>
                              <ul className="list-disc pl-10 space-y-2">
                                {panelItem.detailedContent.exceptionFlow.map((step: string, i: number) => (
                                  <li key={i} className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(cleanText(step))}</li>
                                ))}
                              </ul>
                            </section>
                          )}
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <CheckSquare className="w-4 h-4 text-indigo-500" /> Hậu điều kiện:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.postCondition)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-indigo-500" /> Business rule:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.businessRules)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Database className="w-4 h-4 text-indigo-500" /> Phụ thuộc backend:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.backendDependency)}</p>
                          </section>
                          {panelItem.detailedContent.notes && (
                            <section className={`p-4 rounded-xl border-l-4 border-amber-500 ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                              <h4 className="font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2">
                                <Info className="w-4 h-4" /> Ghi chú:
                              </h4>
                              <p className="text-sm text-amber-800 dark:text-amber-300 italic ml-6">{renderTextWithLinks(panelItem.detailedContent.notes)}</p>
                            </section>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {panelItem.type === 'scr' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-2 flex items-center gap-2">
                          <Smartphone className="w-4 h-4" /> Thông tin màn hình
                        </h3>
                        <div className={`p-4 rounded-lg border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Mục tiêu / UI Logic:</p>
                          <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(panelItem.target)}</p>
                        </div>
                      </section>

                      {panelItem.detailedContent ? (
                        <div className="space-y-6">
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <ChevronRight className="w-4 h-4 text-indigo-500" /> Điều kiện vào màn:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.entryCondition)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Layout className="w-4 h-4 text-indigo-500" /> Thành phần UI:
                            </h4>
                            <ul className="list-disc pl-10 space-y-2">
                              {panelItem.detailedContent.uiComponents.map((item: string, i: number) => (
                                <li key={i} className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(cleanText(item))}</li>
                              ))}
                            </ul>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-indigo-500" /> User actions:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.userActions)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <ShieldCheck className="w-4 h-4 text-indigo-500" /> Validation:
                            </h4>
                            <div className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-line ml-6">
                              {renderTextWithLinks(panelItem.detailedContent.validation)}
                            </div>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Zap className="w-4 h-4 text-indigo-500" /> Data / API:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.dataApi)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <Activity className="w-4 h-4 text-indigo-500" /> States:
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.uiStates)}</p>
                          </section>
                          <section>
                            <h4 className="font-semibold text-gray-900 dark:text-white mb-2 flex items-center gap-2">
                              <ChevronRight className="w-4 h-4 text-indigo-500" /> Điều hướng (Navigation):
                            </h4>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed ml-6">{renderTextWithLinks(panelItem.detailedContent.navigation)}</p>
                          </section>
                          {panelItem.detailedContent.notes && (
                            <section className={`p-4 rounded-xl border-l-4 border-amber-500 ${darkMode ? 'bg-amber-900/20' : 'bg-amber-50'}`}>
                              <h4 className="font-semibold text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2">
                                <Info className="w-4 h-4" /> Ghi chú:
                              </h4>
                              <p className="text-sm text-amber-800 dark:text-amber-300 italic ml-6">{renderTextWithLinks(panelItem.detailedContent.notes)}</p>
                            </section>
                          )}
                        </div>
                      ) : null}
                    </div>
                  )}

                  {panelItem.type === 'api' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <Zap className="w-4 h-4" /> Chi tiết API Endpoint
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-2">Endpoint:</p>
                            <code className={`px-3 py-1.5 rounded-lg text-sm font-mono block w-full ${darkMode ? 'bg-slate-900 text-indigo-400' : 'bg-white text-indigo-700 border border-indigo-100'}`}>
                              {panelItem.endpoint}
                            </code>
                          </div>
                          <div className="flex flex-col md:flex-row gap-4 items-start">
                            <div className={`flex-1 p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                              <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Phân hệ:</p>
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{panelItem.module}</p>
                            </div>
                            <div className={`w-full md:w-auto md:min-w-[180px] p-4 rounded-xl border shrink-0 ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                              <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Trạng thái:</p>
                              <div className="mt-1">
                                <Badge status={panelItem.status} />
                              </div>
                            </div>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Mục đích:</p>
                            <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(panelItem.purpose)}</p>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {panelItem.type === 'rule' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <ShieldCheck className="w-4 h-4" /> Chi tiết Business Rule
                        </h3>
                        <div className={`p-6 rounded-2xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                          <div className="flex items-center gap-2 mb-4">
                            <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-500 text-[10px] font-bold uppercase tracking-widest">
                              {panelItem.group}
                            </span>
                          </div>
                          <h4 className="text-lg font-bold text-gray-900 dark:text-white mb-4">{renderTextWithLinks(panelItem.title)}</h4>
                          <p className="text-base text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-line">
                            {renderTextWithLinks(panelItem.content)}
                          </p>
                        </div>
                      </section>
                    </div>
                  )}

                  {panelItem.type === 'permission' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <Lock className="w-4 h-4" /> Phân quyền & Bảo mật Dữ liệu
                        </h3>
                        <div className="grid grid-cols-1 gap-4">
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Đối tượng dữ liệu:</p>
                            <p className="text-base font-bold text-gray-900 dark:text-white">{renderTextWithLinks(panelItem.object)}</p>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                            <div className={`p-4 rounded-xl border border-rose-200 ${darkMode ? 'bg-rose-900/10 border-rose-900/30' : 'bg-rose-50'}`}>
                              <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-1">Khách vãng lai:</p>
                              <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{renderTextWithLinks(panelItem.guest)}</p>
                            </div>
                            <div className={`p-4 rounded-xl border border-emerald-200 ${darkMode ? 'bg-emerald-900/10 border-emerald-900/30' : 'bg-emerald-50'}`}>
                              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mb-1">Khách hàng (Login):</p>
                              <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">{renderTextWithLinks(panelItem.customer)}</p>
                            </div>
                          </div>
                          <div className={`p-4 rounded-xl border border-amber-200 ${darkMode ? 'bg-amber-900/10 border-amber-900/30' : 'bg-amber-50'}`}>
                            <p className="text-xs font-bold text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-2">
                              <AlertCircle className="w-3 h-3" /> Ghi chú Bảo mật:
                            </p>
                            <p className="text-sm text-amber-800 dark:text-amber-200 italic leading-relaxed">
                              {renderTextWithLinks(panelItem.notes)}
                            </p>
                          </div>
                        </div>
                      </section>
                    </div>
                  )}

                  {panelItem.type === 'traceability' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <FileText className="w-4 h-4" /> Traceability Matrix Detail
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Workflow:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{renderTextWithLinks(panelItem.wf)}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Use Case:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{renderTextWithLinks(panelItem.uc)}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Screen:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{renderTextWithLinks(panelItem.screen)}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">API / Source:</p>
                            <code className="text-xs font-mono text-indigo-500">{panelItem.api}</code>
                          </div>
                        </div>
                        <div className={`mt-4 p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-2">Summary:</p>
                          <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed font-semibold">
                            {renderTextWithLinks(panelItem.summary)}
                          </p>
                        </div>
                      </section>
                    </div>
                  )}

                  {panelItem.type === 'validation' && (
                    <div className="space-y-6">
                      <section>
                        <h3 className="text-sm font-semibold text-indigo-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                          <CheckSquare className="w-4 h-4" /> Field Validation Detail
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Màn hình:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{renderTextWithLinks(panelItem.screen)}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Trường dữ liệu:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{panelItem.field}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Kiểu dữ liệu:</p>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{panelItem.type_val || panelItem.type}</p>
                          </div>
                          <div className={`p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                            <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Bắt buộc:</p>
                            <p className="text-sm font-bold text-indigo-500">{panelItem.required}</p>
                          </div>
                        </div>
                        <div className={`mt-4 p-4 rounded-xl border ${darkMode ? 'bg-slate-800/50 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
                          <p className="text-xs font-bold text-gray-900 dark:text-gray-100 mb-1">Quy tắc (Rule):</p>
                          <p className="text-sm text-gray-900 dark:text-gray-100 leading-relaxed">{renderTextWithLinks(panelItem.rule)}</p>
                        </div>
                        <div className={`mt-4 p-4 rounded-xl border border-rose-200 ${darkMode ? 'bg-rose-900/10 border-rose-900/30' : 'bg-rose-50'}`}>
                          <p className="text-xs font-bold text-rose-600 dark:text-rose-400 mb-1">Thông báo lỗi:</p>
                          <p className="text-sm text-rose-700 dark:text-rose-300 italic font-semibold">{renderTextWithLinks(panelItem.error)}</p>
                        </div>
                      </section>
                    </div>
                  )}
                </div>

                
                  
                      
                      
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className="mt-12 pb-8 text-center">
          <p className="text-xs text-gray-900 dark:text-gray-100 font-semibold uppercase tracking-widest">
            © 2026 F&B Mobile App Project • PRD Master Dashboard • Tài liệu nội bộ
          </p>
        </footer>
      </main>

      {/* Custom Scrollbar for horizontal scroll */}
      <style>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  );
}
