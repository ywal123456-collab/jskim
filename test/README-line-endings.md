# テストの改行比較

`create-jskim` template と repository sample の mirror テストは **内容一致（text equivalence）** 契約です。

Windows で `core.autocrlf=true` のとき、working tree の CRLF / LF がパスごとに食い違うことがあります。
byte-for-byte ではなく内容比較であるため、共通 helper `test/helpers/assert-text-equal.js` で改行を LF に正規化してから比較します。

バイナリの完全一致が必要な比較にはこの helper を使わないでください。
