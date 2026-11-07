import LegalPage, { SupportLink } from "@/components/legal-page";
export const metadata = {
  title: "Chính sách bảo mật | OlpAI Arena",
  description:
    "Cách OlpAI Arena thu thập, sử dụng và bảo vệ dữ liệu tài khoản, Google Sign-In và hoạt động luyện tập.",
  alternates: { canonical: "https://olpaiarena.cyou/privacy" },
};
export default function Page() {
  return (
    <LegalPage
      title="Chính sách bảo mật"
      intro="Cách chúng tôi xử lý thông tin khi bạn khám phá, đăng nhập và luyện tập trên OlpAI Arena."
    >
      <section>
        <h2>1. Dịch vụ và đầu mối liên hệ</h2>
        <p>
          OlpAI Arena tại olpaiarena.cyou là nền tảng luyện tập AI do nhóm vận
          hành OlpAI Arena quản lý. Đây là môi trường luyện tập độc lập, không
          đại diện cho ban tổ chức Olympic AI hoặc Google. Mọi câu hỏi về quyền
          riêng tư, yêu cầu truy cập, sửa hoặc xóa dữ liệu được tiếp nhận tại{" "}
          <SupportLink />.
        </p>
      </section>
      <section>
        <h2>2. Thông tin được thu thập</h2>
        <ul>
          <li>
            <strong>Tài khoản:</strong> tên hiển thị bạn nhập, email, mã định
            danh tài khoản, thời điểm tạo và thay đổi thông tin, liên kết phương
            thức đăng nhập.
          </li>
          <li>
            <strong>Google Sign-In:</strong> Supabase Auth nhận mã định danh
            Google, email và trạng thái xác minh; hồ sơ cơ bản do Google trả về
            có thể gồm tên và ảnh đại diện. Arena yêu cầu bạn tự chọn tên hiển
            thị. Chúng tôi không nhận mật khẩu Google và không yêu cầu quyền đọc
            Gmail, danh bạ hoặc tệp Google Drive cá nhân.
          </li>
          <li>
            <strong>Luyện tập:</strong> đội, lời mời, đăng ký vòng luyện, tệp
            nộp, điểm, thời gian nộp, thông tin Workspace và nội dung chatbot
            nếu bạn sử dụng các chức năng đó.
          </li>
          <li>
            <strong>Vận hành và bảo mật:</strong> cookie phiên đăng nhập, địa
            chỉ IP trong yêu cầu phục vụ giới hạn tần suất và nhật ký lỗi/kỹ
            thuật của hạ tầng. Cookie xác thực ngắn hạn giúp hoàn tất liên kết
            email và OAuth.
          </li>
        </ul>
      </section>
      <section>
        <h2>3. Mục đích sử dụng</h2>
        <p>
          Chúng tôi dùng dữ liệu để xác thực và bảo vệ tài khoản; gửi email xác
          nhận, đổi email và khôi phục mật khẩu; quản lý đội; cung cấp đề, dữ
          liệu và chấm bài; hiển thị kết quả; vận hành Workspace/chatbot và xử
          lý hỗ trợ, lỗi hoặc hành vi lạm dụng. Dữ liệu Google được dùng để xác
          thực, liên kết và quản lý tài khoản theo các mục đích này.
        </p>
        <p>
          Chúng tôi không bán dữ liệu Google, không dùng dữ liệu Google cho
          quảng cáo cá nhân hóa hoặc để huấn luyện mô hình AI. Việc sử dụng và
          chuyển giao thông tin nhận từ Google tuân thủ{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , bao gồm các yêu cầu Limited Use áp dụng.
        </p>
      </section>
      <section>
        <h2>4. Ai có thể xem thông tin</h2>
        <p>
          Tên đội, thứ hạng, điểm và thời gian nộp có thể xuất hiện trên bảng
          xếp hạng công khai. Thành viên cùng đội có thể xem thông tin thành
          viên, bao gồm tên và email/tên đăng nhập, cùng hoạt động luyện tập của
          đội. Quản trị viên có thể truy cập dữ liệu cần thiết để hỗ trợ, quản
          lý vòng luyện và kiểm tra bài nộp. Không nhập dữ liệu nhạy cảm vào tên
          hiển thị, tên đội, bài nộp hoặc chatbot.
        </p>
      </section>
      <section>
        <h2>5. Nhà cung cấp xử lý dữ liệu</h2>
        <p>
          Dịch vụ sử dụng Supabase cho xác thực và cơ sở dữ liệu; Resend để gửi
          email giao dịch; Render để lưu trữ và vận hành web. Tệp có thể được
          lưu qua Upstash Blob; một số chức năng dùng Upstash Redis. Khi bạn sử
          dụng Workspace hoặc chatbot được quản trị viên cấu hình, Runpod, Groq
          hoặc nhà cung cấp mô hình tương ứng có thể xử lý nội dung cần thiết
          cho yêu cầu đó. Chúng tôi không tự gửi hồ sơ Google của bạn cho mô
          hình AI.
        </p>
        <p>
          Dữ liệu có thể được xử lý trên hạ tầng ngoài Việt Nam tùy vị trí dịch
          vụ của các nhà cung cấp. Chúng tôi chỉ chia sẻ thông tin cần cho việc
          cung cấp dịch vụ, xử lý hỗ trợ theo yêu cầu của bạn hoặc thực hiện
          nghĩa vụ pháp lý có áp dụng.
        </p>
      </section>
      <section>
        <h2>6. Lưu giữ và bảo vệ</h2>
        <p>
          Dữ liệu tài khoản và luyện tập được lưu để bạn tiếp tục sử dụng dịch
          vụ và đối chiếu kết quả. Hội thoại được lưu để khôi phục lịch sử khi
          bạn sử dụng chatbot; mở đoạn chat mới không tự xóa lịch sử đã lưu.
          Cookie phiên và mã xác thực có thời hạn. Quyền truy cập được kiểm tra
          ở server; kết nối sử dụng HTTPS và quyền dữ liệu được giới hạn theo
          vai trò.
        </p>
        <p>
          Khi bạn yêu cầu xóa dữ liệu, chúng tôi xác minh chủ tài khoản và xử lý
          dữ liệu có thể xóa; một phần nhật ký an toàn, bằng chứng xử lý tranh
          chấp hoặc kết quả đã tổng hợp có thể được giữ khi cần thiết. Dữ liệu
          trong bản sao lưu được loại bỏ theo vòng đời sao lưu và không được sử
          dụng thường xuyên. Không có hệ thống truyền hoặc lưu dữ liệu nào bảo
          đảm an toàn tuyệt đối.
        </p>
      </section>
      <section>
        <h2>7. Quyền và lựa chọn của bạn</h2>
        <p>
          Bạn có thể xem đề đã công bố và bảng xếp hạng mà không đăng nhập; sửa
          tên hoặc yêu cầu đổi email trong Tài khoản theo giới hạn 30 ngày cho
          từng loại thay đổi. Bạn có thể yêu cầu bản sao, sửa, xóa dữ liệu hoặc
          đóng tài khoản bằng cách gửi email đến <SupportLink /> từ địa chỉ đã
          đăng ký. Chúng tôi sẽ xác minh yêu cầu trước khi cung cấp hoặc thay
          đổi dữ liệu.
        </p>
        <p>
          Bạn có thể thu hồi quyền Google Sign-In tại{" "}
          <a
            href="https://myaccount.google.com/connections"
            target="_blank"
            rel="noopener noreferrer"
          >
            các kết nối tài khoản Google
          </a>
          . Thu hồi quyền không tự xóa tài khoản Arena hoặc bài nộp đã lưu; hãy
          liên hệ nếu muốn xóa các dữ liệu này.
        </p>
      </section>
      <section>
        <h2>8. Phạm vi và cập nhật</h2>
        <p>
          Dịch vụ hướng đến người học và đội luyện tập AI, không được thiết kế
          dành riêng cho trẻ em. Khi chính sách thay đổi, chúng tôi cập nhật
          ngày hiệu lực trên trang này và thông báo về thay đổi đáng kể trong
          ứng dụng. Nếu mở rộng mục đích xử lý dữ liệu Google, chúng tôi sẽ
          thông báo và xin lại sự đồng ý khi cần trước khi áp dụng.
        </p>
      </section>
    </LegalPage>
  );
}
