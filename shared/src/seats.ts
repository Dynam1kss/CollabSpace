// місце людини на дошці — «стілець». На відміну від курсора, це не
// миттєвий показник, а свідомо поставлена позначка: я сиджу отут. Від неї в
// кроці C рахується гучність голосу
export interface SeatPosition {
  x: number;
  y: number;
}

export interface SeatResponse {
  // null — людина ще жодного разу не сідала на цій дошці
  seat: SeatPosition | null;
}

export type SaveSeatRequest = SeatPosition;
