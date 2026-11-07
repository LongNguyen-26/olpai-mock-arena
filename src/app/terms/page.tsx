import LegalPage, { SupportLink } from "@/components/legal-page";
export const metadata = {
  title: "Điều khoản sử dụng | OlpAI Arena",
  description:
    "Điều khoản tài khoản, đội, nội dung luyện tập và sử dụng tài nguyên của OlpAI Arena.",
  alternates: { canonical: "https://olpaiarena.cyou/terms" },
};
export default function Page() {
  return (
    <LegalPage
      title="Điều khoản sử dụng"
      intro="Các nguyên tắc để cùng sử dụng một môi trường luyện tập công bằng, an toàn và hữu ích."
    >
      <section>
        <h2>1. Phạm vi dịch vụ</h2>
        <p>
          OlpAI Arena tại olpaiarena.cyou cung cấp vòng luyện AI, đề bài, dữ
          liệu, nộp bài, bảng xếp hạng và các công cụ hỗ trợ theo cấu hình của
          từng vòng. Nền tảng do nhóm vận hành OlpAI Arena quản lý, là môi
          trường luyện tập độc lập. Nội dung, lịch và điểm trên Arena không thay
          thế thông báo hoặc kết quả chính thức của bất kỳ kỳ thi nào.
        </p>
      </section>
      <section>
        <h2>2. Tài khoản và thông tin cá nhân</h2>
        <p>
          Khi tạo tài khoản hoặc sử dụng chức năng có đăng nhập, bạn đồng ý với
          các điều khoản này và đã đọc <a href="/privacy">Chính sách bảo mật</a>
          . Bạn chịu trách nhiệm về thông tin cung cấp, bảo vệ thông tin đăng
          nhập và hoạt động qua tài khoản của mình. Mỗi thành viên sử dụng tài
          khoản riêng; không chia sẻ mật khẩu hoặc mã xác thực.
        </p>
        <p>
          Tên hiển thị và email có thể được đổi tối đa một lần trong mỗi khoảng
          30 ngày, tính độc lập từ lần đổi thành công gần nhất. Đổi email yêu
          cầu xác thực lại và hoàn tất xác nhận email. Đội trưởng có quyền đổi
          tên đội; việc đổi tên không thay đổi mã đội hoặc lịch sử bài nộp.
        </p>
      </section>
      <section>
        <h2>3. Sử dụng công bằng</h2>
        <ul>
          <li>
            Tuân thủ hướng dẫn của vòng luyện, hạn chế dữ liệu/model và giới hạn
            tài nguyên được công bố cho vòng đó.
          </li>
          <li>
            Không truy cập tài khoản hoặc dữ liệu của người khác trái phép, dò
            mật khẩu, khai thác lỗ hổng, gây gián đoạn hoặc vượt cơ chế giới hạn
            truy cập.
          </li>
          <li>
            Không đưa mã độc, nội dung xâm phạm quyền của người khác, dữ liệu cá
            nhân nhạy cảm hoặc tệp không có quyền sử dụng lên dịch vụ.
          </li>
          <li>
            Không khai thác tài nguyên để đào tiền mã hóa, tấn công hệ thống
            hoặc thực hiện hoạt động ngoài phạm vi được cấp phép.
          </li>
        </ul>
      </section>
      <section>
        <h2>4. Nội dung và bài nộp</h2>
        <p>
          Bạn giữ các quyền mình có đối với nội dung gửi lên, đồng thời cho phép
          Arena lưu trữ, xử lý và hiển thị nội dung ở phạm vi cần thiết để vận
          hành chức năng bạn sử dụng, chấm bài, hỗ trợ và quản lý vòng luyện.
          Tên đội, thứ hạng, điểm và thời gian nộp có thể được công khai. Đề và
          dữ liệu của bên thứ ba tuân theo giấy phép và quy định của nguồn cung
          cấp; việc truy cập trên Arena không mặc nhiên cho phép phân phối lại.
        </p>
      </section>
      <section>
        <h2>5. Workspace, chatbot và dịch vụ bên ngoài</h2>
        <p>
          Khả năng cấp GPU, thời gian chạy, dung lượng và lượt sử dụng phụ thuộc
          cấu hình và tài nguyên còn sẵn. Nếu bạn dùng dịch vụ bên ngoài hoặc
          khóa API riêng, bạn chịu trách nhiệm về quyền sử dụng và chi phí phát
          sinh theo nhà cung cấp đó. Không gửi bí mật hoặc dữ liệu không có
          quyền chia sẻ vào chatbot. Câu trả lời của mô hình có thể sai; bạn cần
          kiểm tra trước khi áp dụng.
        </p>
      </section>
      <section>
        <h2>6. Kết quả và tính sẵn sàng</h2>
        <p>
          Điểm được tính theo bộ chấm và cấu hình của từng vòng luyện; lỗi chấm
          hoặc cấu hình có thể được sửa và tính lại. Dịch vụ có thể gián đoạn do
          bảo trì, lỗi kỹ thuật hoặc nhà cung cấp. Hãy tự giữ bản sao mã nguồn,
          trọng số và tệp cần thiết; Arena không bảo đảm cung cấp liên tục hoặc
          phù hợp mọi mục đích.
        </p>
      </section>
      <section>
        <h2>7. Xử lý vi phạm và chấm dứt</h2>
        <p>
          Nhóm vận hành có thể giới hạn tài nguyên, tạm khóa chức năng hoặc tài
          khoản khi phát hiện lạm dụng, rủi ro an toàn hoặc vi phạm quy định
          vòng luyện. Khi có thể, chúng tôi thông báo lý do và tiếp nhận phản
          hồi. Bạn có thể ngừng sử dụng bất kỳ lúc nào và gửi yêu cầu đóng tài
          khoản, xóa dữ liệu theo Chính sách bảo mật. Các điều khoản này không
          loại trừ quyền hoặc trách nhiệm không thể bị loại trừ theo pháp luật
          áp dụng.
        </p>
      </section>
      <section>
        <h2>8. Liên hệ và cập nhật</h2>
        <p>
          Gửi câu hỏi, báo lỗi hoặc khiếu nại đến <SupportLink />. Chúng tôi ưu
          tiên làm rõ và giải quyết vấn đề qua trao đổi trực tiếp. Điều khoản
          mới được công bố tại trang này với ngày hiệu lực cập nhật; thay đổi
          đáng kể sẽ được thông báo trong ứng dụng.
        </p>
      </section>
    </LegalPage>
  );
}
